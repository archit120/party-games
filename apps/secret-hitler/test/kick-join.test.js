import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
test("host kick frees lobby seats; join retries recover sessions without creating ghosts, including full/started rooms", async () => {
  const dir = await mkdtemp("/tmp/sh-kick-");
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "0", DATA_DIR: dir, OPENROUTER_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [buf] = await once(child.stdout, "data");
    const base =
      "http://127.0.0.1:" + String(buf).match(/listening on (\d+)/)[1];
    async function req(path, body, token) {
      const r = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    }
    const h = (await req("/api/create", { name: "Host" })).body,
      path = "/api/rooms/" + h.code;
    const join = { code: h.code, name: "Guest", joinKey: "a".repeat(64) };
    const guest = (await req("/api/join", join)).body;
    for (let i = 0; i < 8; i++)
      assert.equal(
        (await req("/api/join", { code: h.code, name: "Seat " + i })).status,
        200,
      );
    const retry = await req("/api/join", join);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.token, guest.token);
    assert.equal(retry.body.state.players.length, 10);
    assert.ok(retry.body.state.players.every((p) => !p.joinKey && !p.token));
    assert.equal(
      (await req("/api/join", { ...join, joinKey: "b".repeat(64) })).status,
      400,
    );
    assert.equal(
      (await req(path + "/kick", { target: guest.state.me.id })).status,
      401,
    );
    assert.equal(
      (await req(path + "/kick", { target: h.state.me.id }, guest.token))
        .status,
      403,
    );
    assert.equal(
      (await req(path + "/kick", { target: h.state.me.id }, h.token)).status,
      400,
    );
    assert.equal(
      (await req(path + "/kick", { target: guest.state.me.id }, h.token))
        .status,
      200,
    );
    assert.equal((await req(path, null, guest.token)).status, 401);
    const replacement = (
      await req("/api/join", { ...join, joinKey: "c".repeat(64) })
    ).body;
    assert.ok(replacement.token);
    assert.notEqual(replacement.token, guest.token);
    let state = (await req(path, null, h.token)).body;
    state = (
      await req(
        path + "/action",
        { type: "start", revision: state.revision, payload: {} },
        h.token,
      )
    ).body;
    assert.equal(
      (await req(path + "/kick", { target: replacement.state.me.id }, h.token))
        .status,
      403,
    );
    assert.equal(
      (await req("/api/join", { ...join, joinKey: "c".repeat(64) })).body.token,
      replacement.token,
    );
    assert.equal((await req(path + "/recovery", { target: replacement.state.me.id }, replacement.token)).status, 403);
    assert.equal((await req(path + "/recovery", { target: replacement.state.me.id })).status, 401);
    const beforeRecovery = (await req(path, null, replacement.token)).body;
    const grant = (await req(path + "/recovery", { target: replacement.state.me.id }, h.token)).body;
    assert.match(grant.key, /^[a-f0-9]{64}$/);
    assert.equal((await req("/api/recover", { code: h.code, key: "0".repeat(64) })).status, 401);
    const recovered = await req("/api/recover", { code: h.code, key: grant.key });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.token, replacement.token);
    assert.deepEqual((await req(path, null, recovered.body.token)).body, beforeRecovery);
    // A lost response can be retried without orphaning or duplicating the seat.
    assert.equal((await req("/api/recover", { code: h.code, key: grant.key })).body.token, replacement.token);
    const secondGrant = (await req(path + "/recovery", { target: replacement.state.me.id }, h.token)).body;
    assert.equal((await req("/api/recover", { code: h.code, key: grant.key })).status, 401);
    const publicState = (await req(path, null, h.token)).body;
    assert.ok(publicState.players.every(p => !p.recovery && !p.token && !p.joinKey));
    state = (await req(path + "/action", { type: "end-game", revision: publicState.revision }, h.token)).body;
    state = (await req(path + "/action", { type: "restart", revision: state.revision }, h.token)).body;
    assert.equal(state.phase, "lobby");
    assert.equal((await req("/api/join", { ...join, joinKey: "c".repeat(64) })).body.token, replacement.token);
    assert.equal((await req("/api/recover", { code: h.code, key: secondGrant.key })).status, 401);
    const kickGrant = (await req(path + "/recovery", { target: replacement.state.me.id }, h.token)).body;
    await req(path + "/kick", { target: replacement.state.me.id }, h.token);
    assert.equal((await req("/api/recover", { code: h.code, key: kickGrant.key })).status, 401);
  } finally {
    const done = once(child, "exit");
    child.kill();
    await done;
    await rm(dir, { recursive: true, force: true });
  }
});
