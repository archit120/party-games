import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
test("shared room server: joins, concurrent ballots, recovery, restart persistence and private assets", async () => {
  const dir = await mkdtemp(tmpdir() + "/undercover-");
  let child, base;
  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, PORT: "0", DATA_DIR: dir },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [out] = await once(child.stdout, "data");
    base = "http://127.0.0.1:" + String(out).trim().split(" ").at(-1);
  }
  async function stop() {
    const done = once(child, "exit");
    child.kill();
    await done;
  }
  async function call(path, body, token, headers = {}) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    await start();
    const a = (await call("/api/create", { name: "Alice" })).data,
      code = a.code,
      players = [a];
    for (let i = 1; i < 5; i++)
      players.push(
        (
          await call("/api/join", {
            name: "P" + i,
            code,
            joinKey: String(i).repeat(64),
          })
        ).data,
      );
    const path = "/api/rooms/" + code;
    assert.equal(
      (await call(path + "/bots", { operation: "add" }, players[1].token))
        .status,
      403,
    );
    let bots = (await call(path + "/bots", { operation: "add" }, a.token)).data;
    const bot = bots.players.find((p) => p.bot);
    assert.ok(bot);
    assert.equal(
      (await call(path + "/recovery", { target: bot.id }, a.token)).status,
      400,
    );
    await call(
      path + "/bots",
      { operation: "remove", target: bot.id },
      a.token,
    );

    assert.equal((await call(path)).status, 401);
    assert.equal(
      (
        await call(path + "/action", { type: "start" }, a.token, {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    let state = (await call(path, null, a.token)).data;
    const act = async (p, type, payload = {}) => {
      const r = await call(
        path + "/action",
        {
          type,
          payload,
          revision: state.revision,
          voteId: state.voteId,
          gameId: state.gameId,
        },
        p.token,
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      state = r.data;
    };
    await act(a, "start");
    assert.equal(
      (await call("/api/join", { name: "P1", code, joinKey: "1".repeat(64) }))
        .data.token,
      players[1].token,
    );
    assert.equal((await call("/api/join", { name: "Late", code })).status, 400);
    assert.equal((await call(path + "/leave", {}, a.token)).status, 409);
    while (state.phase === "clue") {
      const p = players.find((p) => p.state.me.id === state.turn);
      await act(p, "clue", { text: "hello" });
    }
    await act(a, "openVote");
    const election = {
      revision: state.revision,
      voteId: state.voteId,
      gameId: state.gameId,
    };
    const results = await Promise.all(
      players.map((p, i) =>
        call(
          path + "/action",
          {
            ...election,
            type: "vote",
            payload: { target: players[(i + 1) % 5].state.me.id },
          },
          p.token,
        ),
      ),
    );
    assert.ok(results.every((r) => r.status === 200));
    state = (await call(path, null, a.token)).data;
    assert.equal(state.runoff, true);
    assert.equal(
      (
        await call(
          path + "/action",
          {
            ...election,
            type: "vote",
            payload: { target: players[1].state.me.id },
          },
          a.token,
        )
      ).status,
      409,
    );
    const recovery = (
      await call(
        path + "/recovery",
        { target: players[1].state.me.id },
        a.token,
      )
    ).data;
    assert.equal(
      (await call("/api/recover", { code, key: recovery.key })).data.token,
      players[1].token,
    );
    assert.equal(
      (
        await call(
          path + "/recovery",
          { target: a.state.me.id },
          players[1].token,
        )
      ).status,
      403,
    );
    await stop();
    await start();
    assert.deepEqual((await call(path, null, a.token)).data, state);
    const asset = await fetch(base + "/shared/client.js");
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /export async function request/);
    assert.equal((await fetch(base + "/../game.js")).status, 404);
  } finally {
    if (child?.exitCode === null) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
