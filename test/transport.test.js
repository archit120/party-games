import { test } from "node:test";
import assert from "node:assert/strict";
import { beginAction } from "../packages/core/state.js";
import {
  createPollGate,
  newerState,
  request,
} from "../packages/core/client.js";
test("stale actions fail before mutation; failed moves do not mutate live rooms", () => {
  const room = { revision: 3, players: [{ coins: 2 }] };
  assert.throws(
    () => beginAction(room, { revision: 2 }),
    (e) => e.status === 409,
  );
  const copy = beginAction(room, { revision: 3 });
  copy.players[0].coins = 0;
  assert.equal(room.players[0].coins, 2);
  assert.equal(
    beginAction(room, { revision: 1, concurrent: true }).revision,
    3,
  );
  assert.equal(
    beginAction({ rev: 4 }, { revision: 4, revisionKey: "rev" }).rev,
    4,
  );
});
test("slow polls cannot replace newer action state or cross room boundaries", () => {
  const current = { code: "ABCDEF", revision: 5 };
  assert.equal(newerState(current, { code: "ABCDEF", revision: 4 }), false);
  assert.equal(newerState(current, { code: "ABCDEF", revision: 5 }), false);
  assert.equal(newerState(current, { code: "UVWXYZ", revision: 9 }), false);
  assert.equal(newerState(current, { code: "ABCDEF", revision: 6 }), true);
  assert.equal(
    newerState({ code: "ABCDEF", rev: 4 }, { code: "ABCDEF", rev: 3 }, "rev"),
    false,
  );
});
test("one poll in flight; switching sessions discards old data and old auth errors", async () => {
  const poll = createPollGate();
  let session = { token: "a" },
    resolve,
    calls = 0,
    applied = 0,
    errors = 0;
  const args = () => ({
    session,
    getSession: () => session,
    load: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    onState: () => applied++,
    onError: () => errors++,
  });
  const pending = poll(args());
  await poll(args());
  assert.equal(calls, 1);
  session = { token: "b" };
  resolve({});
  await pending;
  assert.equal(applied, 0);
  let reject;
  const failed = poll({
    ...args(),
    load: () => new Promise((r, j) => (reject = j)),
  });
  session = { token: "c" };
  reject(Error("unauthorized old seat"));
  await failed;
  assert.equal(errors, 0);
  await poll({ ...args(), load: async () => ({}) });
  assert.equal(applied, 1);
});
test("browser transport reports HTML proxy failures and keeps status on JSON errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      });
    await assert.rejects(() => request("/api/state"), /reconnecting/);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "stale" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      () => request("/api/state"),
      (e) => e.status === 409 && e.message === "stale",
    );
  } finally {
    globalThis.fetch = original;
  }
});
