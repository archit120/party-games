import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { attachRoomSockets } from "../packages/core/realtime.js";
import { createRoomTransport, newerState } from "../packages/core/client.js";

test("room sockets authenticate, filter private views, publish changes and revoke removed seats", async () => {
  const room = {
    code: "ABCDEF",
    revision: 1,
    players: [
      { id: "a", token: "secret-a" },
      { id: "b", token: "secret-b" },
    ],
  };
  const server = http.createServer();
  const hub = attachRoomSockets(server, {
    getRoom: (c) => (c === room.code ? room : null),
    view: (g, id) => ({ code: g.code, revision: g.revision, privateWord: id }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/api/live`;
  const clients = [];
  async function connect(token) {
    const ws = new WebSocket(url);
    clients.push(ws);
    await once(ws, "open");
    const response = once(ws, token === "bad" ? "close" : "message");
    ws.send(JSON.stringify({ code: room.code, token }));
    return [ws, await response];
  }
  try {
    const [, [code]] = await connect("bad");
    assert.equal(code, 4001);
    const [a, [first]] = await connect("secret-a");
    const [b, [second]] = await connect("secret-b");
    assert.equal(JSON.parse(first).state.privateWord, "a");
    assert.equal(JSON.parse(second).state.privateWord, "b");
    assert.equal(first.toString().includes("secret-"), false);
    const update = once(a, "message");
    room.revision++;
    hub.publish();
    assert.equal(JSON.parse((await update)[0]).state.revision, 2);
    const revoked = once(b, "close");
    room.players.pop();
    hub.publish();
    assert.equal((await revoked)[0], 4001);
    const [reconnected, [snapshot]] = await connect("secret-a");
    assert.equal(JSON.parse(snapshot).state.revision, 2);
    reconnected.close();
    const crossOrigin = new WebSocket(url, {
      origin: "https://unrelated.example",
    });
    clients.push(crossOrigin);
    await new Promise((resolve) =>
      crossOrigin.on("error", (e) => {
        assert.match(e.message, /403/);
        resolve();
      }),
    );
  } finally {
    clients.forEach((ws) => ws.terminate());
    await new Promise((resolve) => server.close(resolve));
  }
});

test("shared client runs slow parallel polls, falls back, reconnects and ignores old seat updates", async () => {
  let time = 0,
    calls = 0,
    session = { code: "ABCDEF", token: "a" },
    state;
  const sockets = [];
  class FakeSocket {
    constructor() {
      sockets.push(this);
    }
    send(raw) {
      this.auth = JSON.parse(raw);
    }
    close() {
      this.onclose?.();
    }
    state(revision) {
      this.onmessage({
        data: JSON.stringify({
          type: "state",
          state: { code: "ABCDEF", revision },
        }),
      });
    }
  }
  const oldLocation = globalThis.location;
  globalThis.location = { href: "https://example.com/" };
  const sync = createRoomTransport({
    WebSocketImpl: FakeSocket,
    now: () => time,
    random: () => 0.5,
  });
  const args = () => ({
    session,
    credentials: session,
    getSession: () => session,
    load: async () => {
      calls++;
      return { code: "ABCDEF", revision: 1 };
    },
    onState: (s) => {
      if (newerState(state, s)) state = s;
    },
    onError: (e) => {
      throw e;
    },
  });
  try {
    await sync(args());
    const a = sockets[0];
    a.onopen();
    a.state(3);
    assert.equal(a.auth.token, "a");
    time = 1200;
    await sync(args());
    assert.equal(calls, 1);
    time = 16000;
    await sync(args());
    assert.equal(calls, 2);
    assert.equal(state.revision, 3);
    a.close();
    time += 1200;
    await sync(args());
    assert.equal(calls, 3);
    assert.equal(sockets.length, 2);
    session = { code: "ABCDEF", token: "b" };
    state = null;
    await sync(args());
    a.state(99);
    assert.equal(state.revision, 1);
    sockets.at(-1).onopen();
    sockets.at(-1).state(4);
    assert.equal(state.revision, 4);
    session = null;
    await sync(args());
    assert.equal(sockets.at(-1).auth.token, "b");
  } finally {
    globalThis.location = oldLocation;
  }
});
