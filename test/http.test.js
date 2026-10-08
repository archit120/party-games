import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
test("HTTP authentication, stale revisions, origin checks and persistence", async () => {
  const dir = await mkdtemp(tmpdir() + "/coup-test-");
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
  async function call(path, b, token, headers = {}) {
    const r = await fetch(base + "/api/" + path, {
      method: b ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    return [r.status, await r.json()];
  }
  try {
    await start();
    const [, a] = await call("create", { name: "Alice" });
    const code = a.view.code;
    const [, b] = await call("join", { name: "Bob", code });
    assert.equal((await call("state?code=" + code))[0], 401);
    assert.equal(
      (
        await call("action", { code, rev: b.view.rev, type: "start" }, b.token)
      )[0],
      400,
    );
    assert.equal(
      (await call("action", { code, rev: 0, type: "start" }, a.token))[0],
      409,
    );
    assert.equal(
      (
        await call(
          "action",
          { code, rev: b.view.rev, type: "start" },
          a.token,
          { Origin: "https://evil.example" },
        )
      )[0],
      403,
    );
    const [status, started] = await call(
      "action",
      { code, rev: b.view.rev, type: "start" },
      a.token,
    );
    assert.equal(status, 200);
    assert.equal(started.players[1].cards[0].role, null);
    await stop();
    await start();
    const [, restored] = await call("state?code=" + code, null, a.token);
    assert.deepEqual(restored, started);
    assert.equal((await call("join", { name: "Late", code }))[0], 400);
  } finally {
    if (child.exitCode === null) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
