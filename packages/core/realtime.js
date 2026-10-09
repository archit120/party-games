import { WebSocketServer, WebSocket } from "ws";
import { authenticate } from "./rooms.js";

// Credentials travel in the first frame, never in URLs or proxy access logs.
export function attachRoomSockets(server, { getRoom, view, touch = () => {} }) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  function snapshot(ws, force = false) {
    const room = getRoom(ws.code);
    const player = authenticate(room, ws.token);
    if (!player) return ws.close(4001, "Seat unavailable");
    const revision = room.revision ?? room.rev;
    if (!force && ws.revision === revision) return;
    if (ws.bufferedAmount > 1024 * 1024) return ws.terminate();
    ws.send(JSON.stringify({ type: "state", state: view(room, player.id) }));
    ws.revision = revision;
  }
  server.on("upgrade", (req, socket, head) => {
    try {
      if (
        req.url !== "/api/live" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) =>
        sockets.emit("connection", ws),
      );
    } catch {
      socket.destroy();
    }
  });
  sockets.on("connection", (ws) => {
    ws.alive = true;
    const timeout = setTimeout(() => ws.terminate(), 5000);
    timeout.unref();
    ws.on("error", () => {});
    ws.on("close", () => clearTimeout(timeout));
    ws.on("pong", () => {
      ws.alive = true;
      if (ws.code) {
        snapshot(ws);
        touch(ws.code);
      }
    });
    ws.on("message", (raw) => {
      if (ws.code) return ws.close(1008, "Already subscribed");
      try {
        const { code, token } = JSON.parse(raw);
        if (
          typeof code !== "string" ||
          !/^[A-Z]{6}$/.test(code) ||
          typeof token !== "string" ||
          !authenticate(getRoom(code), token)
        ) {
          return ws.close(4001, "Seat unavailable");
        }
        ws.code = code;
        ws.token = token;
        clearTimeout(timeout);
        touch(code);
        snapshot(ws, true);
      } catch {
        ws.close(1008, "Invalid subscription");
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 20000);
  heartbeat.unref();
  server.on("close", () => {
    clearInterval(heartbeat);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  });
  let queued = false;
  return {
    publish() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        for (const ws of sockets.clients)
          if (ws.code && ws.readyState === WebSocket.OPEN) snapshot(ws);
      });
    },
  };
}
