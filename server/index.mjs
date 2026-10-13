import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { WebSocketServer } from "ws";
import { broadcastRoster, createRoom, getOrCreateRoom } from "./rooms.mjs";

const ROOT = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/+$/, "");
const LAN_HOST = process.env.LAN_HOST;
const rooms = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function findLanAddress() {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => !address.startsWith("169.254."));
  return addresses.find((address) => address.startsWith("192.168.")) ||
    addresses.find((address) => address.startsWith("10.")) ||
    addresses.find((address) => {
      const secondOctet = Number(address.split(".")[1]);
      return address.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31;
    }) ||
    addresses[0] ||
    null;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function publicOrigin(request) {
  if (PUBLIC_URL) {
    return PUBLIC_URL;
  }
  let host = request.headers.host;
  if (!host || /[\r\n]/.test(host)) {
    throw new Error("The request does not contain a valid host.");
  }
  if (/^(localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(host)) {
    const lanAddress = LAN_HOST || findLanAddress();
    if (lanAddress) {
      host = `${lanAddress}${host.match(/:\d+$/)?.[0] || ""}`;
    }
  }
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(ROOT, requestedPath));
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js", ".json"].includes(extname(filePath))
        ? "no-cache"
        : "public, max-age=3600"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, publicOrigin(request));
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const room = createRoom(rooms);
      const origin = publicOrigin(request);
      const controllerUrl = new URL("/?mode=controller", origin);
      controllerUrl.searchParams.set("room", room.code);
      const qr = await QRCode.toDataURL(controllerUrl.toString(), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256,
        color: { dark: "#10222a", light: "#ffffff" }
      });
      sendJson(response, 201, { code: room.code, controllerUrl: controllerUrl.toString(), qr });
      return;
    }
    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }
    response.writeHead(405, { Allow: "GET, POST" });
    response.end("Method not allowed");
  } catch (error) {
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "The request could not be completed." });
    } else {
      response.destroy(error);
    }
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/ws" || !url.searchParams.get("room")) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit("connection", webSocket, request, url);
  });
});

wss.on("connection", (webSocket, _request, url) => {
  const room = getOrCreateRoom(rooms, url.searchParams.get("room"));
  if (!room) {
    webSocket.close(1008, "Invalid room code");
    return;
  }
  let clientInfo = null;
  room.lastActivity = Date.now();
  webSocket.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      webSocket.close(1007, "Invalid JSON");
      return;
    }
    if (message.type === "join") {
      const role = message.role === "game" ? "game" : message.role === "controller" ? "controller" : null;
      if (!role || clientInfo) {
        webSocket.close(1008, "Invalid join");
        return;
      }
      const roleCount = [...room.clients.values()].filter((client) => client.role === role).length;
      if (roleCount >= (role === "controller" ? 8 : 4)) {
        webSocket.close(1013, "Room is full");
        return;
      }
      const id = role === "controller" && typeof message.id === "string"
        ? message.id.slice(0, 64)
        : `game-${room.clients.size}`;
      const name = typeof message.name === "string" ? message.name.slice(0, 24) : "Driver";
      clientInfo = { role, id, name };
      room.clients.set(webSocket, clientInfo);
      room.lastActivity = Date.now();
      webSocket.send(JSON.stringify({
        type: "joined",
        role,
        room: room.code,
        players: [...room.controls.values()]
      }));
      broadcastRoster(room);
      return;
    }
    if (message.type === "ping") {
      webSocket.send(JSON.stringify({ type: "pong", sentAt: Number(message.sentAt) || 0 }));
      return;
    }
    if (message.type !== "control" || !clientInfo || clientInfo.role !== "controller") {
      return;
    }
    const finiteUnit = (value) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    const state = {
      id: clientInfo.id,
      name: clientInfo.name,
      tilt: finiteUnit(message.tilt),
      throttle: finiteUnit(message.throttle),
      brake: Boolean(message.brake),
      jump: Boolean(message.jump),
      sentAt: Number(message.sentAt) || Date.now()
    };
    room.controls.set(clientInfo.id, state);
    room.lastActivity = Date.now();
    const payload = JSON.stringify({ type: "control", player: state });
    for (const client of room.clients.keys()) {
      if (client !== webSocket && client.readyState === 1) {
        client.send(payload);
      }
    }
  });
  webSocket.on("close", () => {
    if (!clientInfo) {
      return;
    }
    room.clients.delete(webSocket);
    room.lastActivity = Date.now();
    if (clientInfo.role === "controller") {
      room.controls.delete(clientInfo.id);
      broadcastRoster(room);
      const payload = JSON.stringify({ type: "control", player: { id: clientInfo.id, disconnected: true } });
      for (const client of room.clients.keys()) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    }
  });
});

const heartbeat = setInterval(() => {
  for (const webSocket of wss.clients) {
    if (webSocket.isAlive === false) {
      webSocket.terminate();
      continue;
    }
    webSocket.isAlive = false;
    webSocket.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && now - room.lastActivity > 30 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 30_000);

wss.on("connection", (webSocket) => {
  webSocket.isAlive = true;
  webSocket.on("pong", () => { webSocket.isAlive = true; });
});

server.listen(PORT, HOST, () => {
  console.log(`Tilt Racer listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const webSocket of wss.clients) {
    webSocket.close(1001, "Server shutting down");
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
