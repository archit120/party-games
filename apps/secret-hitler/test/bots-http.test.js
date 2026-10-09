import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
test("host-only AI settings, seat limits, human host transfer and empty room cleanup", async () => {
  const dir = await mkdtemp(tmpdir() + "/bots-http-");
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "0",
      DATA_DIR: dir,
      OPENROUTER_API_KEY: "test-key",
      AI_DAILY_BUDGET_USD: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [output] = await once(child.stdout, "data");
    const base =
      "http://localhost:" + String(output).match(/listening on (\d+)/)[1];
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
    const host = (await req("/api/create", { name: "Host" })).body,
      path = "/api/rooms/" + host.code;
    assert.equal((await req(path + "/chat", { text: "Hello" })).status, 401);
    const chatted = await req(
      path + "/chat",
      { text: "Hello table" },
      host.token,
    );
    assert.equal(chatted.status, 200);
    assert.equal(chatted.body.chatMessages[0].text, "Hello table");
    assert.equal(chatted.body.players[0].chatTimes, undefined);
    assert.equal(
      (await req(path + "/chat", { text: "Too soon" }, host.token)).status,
      400,
    );
    let state;
    for (let i = 0; i < 4; i++) {
      const r = await req(path + "/bots", { operation: "add" }, host.token);
      assert.equal(r.status, 200);
      state = r.body;
    }
    assert.equal(state.players.filter((p) => p.bot).length, 4);
    assert.equal(
      (await req(path + "/bots", { operation: "add" }, host.token)).status,
      400,
    );
    const guest = (await req("/api/join", { code: host.code, name: "Guest" }))
      .body;
    assert.equal(
      (
        await req(
          path + "/bots",
          { operation: "remove", target: state.players[1].id },
          guest.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await req(
          path + "/bots",
          { operation: "remove", target: host.state.me.id },
          host.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await req(
          path + "/bots",
          { operation: "comments", enabled: false },
          host.token,
        )
      ).body.aiComments,
      false,
    );
    assert.equal(
      (
        await req(
          path + "/bots",
          { operation: "remove", target: state.players[1].id },
          host.token,
        )
      ).status,
      200,
    );
    await req(path + "/leave", {}, host.token);
    state = (await req(path, null, guest.token)).body;
    assert.equal(state.host, guest.state.me.id);
    await req(path + "/leave", {}, guest.token);
    assert.equal(
      (await req("/api/join", { code: host.code, name: "Late" })).status,
      400,
    );
  } finally {
    const exit = once(child, "exit");
    child.kill();
    await exit;
    await rm(dir, { recursive: true, force: true });
  }
});
