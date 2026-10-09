import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readJSON, writeJSON } from "../packages/core/storage.js";
import {
  roomCode,
  authenticate,
  issueRecovery,
  recoverSeat,
  joinSeat,
} from "../packages/core/rooms.js";
test("shared storage preserves the legacy JSON shape and private file permissions", async () => {
  const dir = await mkdtemp(tmpdir() + "/party-core-");
  try {
    const f = dir + "/rooms.json",
      g = { ABCDEF: { players: [{ token: "private" }] } };
    writeJSON(f, g);
    assert.deepEqual(readJSON(f), g);
    assert.equal((await stat(f)).mode & 0o777, 0o600);
    writeJSON(f, {});
    assert.deepEqual(readJSON(f), {});
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("seat recovery expires and replaced links cannot recover", () => {
  const p = { id: "a", token: "secret" },
    g = { players: [p] };
  assert.equal(authenticate(g), undefined);
  assert.equal(authenticate(g, "Bearer secret"), p);
  const key = issueRecovery(p, 1000);
  assert.equal(recoverSeat(g, key, 1001), p);
  assert.equal(recoverSeat(g, key, 901000), undefined);
  issueRecovery(p, 1002);
  assert.equal(recoverSeat(g, key, 1003), undefined);
  assert.equal(recoverSeat(g, "bad"), undefined);
});
test("joining is retry safe even after start and rejects duplicate names", () => {
  const g = { phase: "lobby", players: [] },
    p = { name: "Alice" },
    key = "a".repeat(64);
  assert.equal(joinSeat(g, p, key, 3).added, true);
  g.phase = "clue";
  assert.equal(joinSeat(g, { name: "Alice" }, key, 3).added, false);
  assert.throws(() => joinSeat(g, { name: "Bob" }, key, 3));
  g.phase = "lobby";
  assert.throws(() => joinSeat(g, { name: "alice" }, null, 3));
  assert.equal(g.players.length, 1);
});
test("room codes avoid collisions and ambiguous characters", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = roomCode((c) => seen.has(c));
    assert.match(code, /^[A-HJ-NP-Z]{6}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 1000);
});
