const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(value) {
  return typeof value === "string" &&
    new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(value.toUpperCase())
    ? value.toUpperCase()
    : null;
}

export function createRoom(rooms, random = Math.random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      const room = { code, clients: new Map(), controls: new Map(), lastActivity: Date.now() };
      rooms.set(code, room);
      return room;
    }
  }
  throw new Error("Could not allocate a unique room code.");
}

export function getOrCreateRoom(rooms, value) {
  const code = normalizeRoomCode(value);
  if (!code) {
    return null;
  }
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      clients: new Map(),
      controls: new Map(),
      lastActivity: Date.now()
    });
  }
  return rooms.get(code);
}

export function getRoster(room) {
  return [...room.clients.values()]
    .filter((client) => client.role === "controller")
    .map(({ id, name }) => ({ id, name }));
}

export function broadcastRoster(room) {
  const message = JSON.stringify({ type: "roster", players: getRoster(room) });
  for (const client of room.clients.keys()) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}
