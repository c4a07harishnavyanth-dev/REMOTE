import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, getOrCreateRoom, getRoster, normalizeRoomCode } from "./rooms.mjs";

test("room codes normalize case and reject ambiguous or malformed values", () => {
  assert.equal(normalizeRoomCode("ab2xyz"), "AB2XYZ");
  assert.equal(normalizeRoomCode("ABO2XY"), null);
  assert.equal(normalizeRoomCode("SHORT"), null);
  assert.equal(normalizeRoomCode(null), null);
});

test("room creation avoids collisions and room lookup is case insensitive", () => {
  const rooms = new Map();
  createRoom(rooms, () => 0);
  const second = createRoom(rooms, () => 0.1);
  assert.notEqual(second.code, "AAAAAA");
  assert.equal(getOrCreateRoom(rooms, second.code.toLowerCase()), second);
});

test("roster only includes joined controllers", () => {
  const room = { clients: new Map() };
  room.clients.set({}, { role: "game", id: "game" });
  room.clients.set({}, { role: "controller", id: "phone-1", name: "Phone 1" });
  assert.deepEqual(getRoster(room), [{ id: "phone-1", name: "Phone 1" }]);
});
