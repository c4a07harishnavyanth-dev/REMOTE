import { startController } from "./controller.js";
import { startGame } from "./game.js";

const gameView = document.querySelector("#game-view");
const controllerView = document.querySelector("#controller-view");
const roomParameter = new URLSearchParams(location.search).get("room");
const isController = new URLSearchParams(location.search).get("mode") === "controller";

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Offline shell could not be installed:", error);
  });
}

if (isController) {
  document.body.classList.add("controller-mode");
  gameView.hidden = true;
  controllerView.hidden = false;
  startController(roomParameter);
} else {
  controllerView.hidden = true;
  gameView.hidden = false;
  startGame();
}

export function connectRoom(room, role, name, onMessage, onStatus) {
  let socket;
  let closed = false;
  let retryTimer;
  let pingTimer;
  let retryAttempt = 0;

  const connect = () => {
    if (closed) {
      return;
    }
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws?room=${encodeURIComponent(room)}`);
    socket.addEventListener("open", () => {
      retryAttempt = 0;
      socket.send(JSON.stringify({
        type: "join",
        role,
        name: typeof name === "string" ? name : name.display,
        id: typeof name === "string" ? "" : name.id
      }));
      onStatus(true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
        }
      }, 1000);
    });
    socket.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Received an invalid message from the race server:", error);
      }
    });
    socket.addEventListener("close", (event) => {
      clearInterval(pingTimer);
      if (closed) {
        return;
      }
      onStatus(false, event.code === 1013 ? "This room is full." : null);
      const delay = Math.min(500 * (2 ** retryAttempt), 8000) + Math.random() * 250;
      retryAttempt += 1;
      retryTimer = setTimeout(connect, delay);
    });
    socket.addEventListener("error", () => socket.close());
  };

  connect();
  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 8192) {
        socket.send(JSON.stringify(message));
      }
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close(1000, "Leaving room");
    }
  };
}
