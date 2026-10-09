import { attachRoomSockets } from "../../packages/core/realtime.js";
import { beginAction } from "../../packages/core/state.js";
import http from "node:http";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { ensureDataDir, writeJSON } from "../../packages/core/storage.js";
import {
  securityHeaders,
  sendJSON,
  readBody,
  serveCoreAsset,
} from "../../packages/core/http.js";
import { roomCode, authenticate } from "../../packages/core/rooms.js";
import { create, player, move, view } from "./game.js";
const dir = process.env.DATA_DIR || "./data";
ensureDataDir(dir);
const rooms = new Map(),
  ttl = 7 * 86400000;
for (const f of readdirSync(dir).filter((f) => /^[A-Z]{6}\.json$/.test(f))) {
  const g = JSON.parse(readFileSync(`${dir}/${f}`));
  if (Date.now() - g.updated < ttl) rooms.set(g.code, g);
  else unlinkSync(`${dir}/${f}`);
}
let realtime;
const save = (g) => {
  g.updated = Date.now();
  const path = `${dir}/${g.code}.json`;
  writeJSON(path, g);
  rooms.set(g.code, g);
  realtime?.publish();
};
const rates = new Map();
function rate(ip) {
  const now = Date.now();
  let r = rates.get(ip);
  if (!r || now - r.time > 60000) {
    r = { time: now, n: 0 };
    rates.set(ip, r);
  }
  if (++r.n > 60) throw Error("Too many requests. Try again in a minute.");
}
setInterval(() => {
  for (const [ip, r] of rates)
    if (Date.now() - r.time > 60000) rates.delete(ip);
  for (const [code, g] of rooms)
    if (Date.now() - g.updated > ttl) {
      rooms.delete(code);
      realtime?.publish();
      unlinkSync(`${dir}/${code}.json`);
    }
}, 60000).unref();
const assets = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
};
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, "http://localhost");
  const json = (status, data) => sendJSON(res, status, data);
  try {
    if (req.method === "GET" && url.pathname === "/health")
      return json(200, { ok: true });
    if (serveCoreAsset(url.pathname, res)) return;
    if (req.method === "GET" && assets[url.pathname]) {
      const [f, t] = assets[url.pathname];
      res.writeHead(200, { "Content-Type": t, "Cache-Control": "no-cache" });
      return res.end(readFileSync(new URL(`./public/${f}`, import.meta.url)));
    }
    if (!url.pathname.startsWith("/api/"))
      return json(404, { error: "Not found" });
    let b = {};
    if (req.method === "POST") b = await readBody(req, 8192);
    if (
      req.method === "POST" &&
      ["/api/create", "/api/join"].includes(url.pathname)
    ) {
      rate(req.socket.remoteAddress);
      const name = String(b.name || "").trim();
      if (!name || name.length > 24)
        throw Error("Enter a name of 1–24 characters.");
      let g, p;
      if (url.pathname === "/api/create") {
        if (rooms.size >= 500) throw Error("Server is full. Try again later.");
        const code = roomCode((code) => rooms.has(code));
        g = create(code, name);
        p = g.players[0];
      } else {
        g = structuredClone(rooms.get(String(b.code || "").toUpperCase()));
        if (!g) throw Error("Room not found.");
        if (g.phase !== "lobby" || g.players.length >= 6)
          throw Error("This room has started or is full.");
        p = player(name);
        g.players.push(p);
        g.rev++;
      }
      save(g);
      return json(200, { token: p.token, view: view(g, p.id) });
    }
    const code = String(
      b.code || url.searchParams.get("code") || "",
    ).toUpperCase();
    const old = rooms.get(code);
    if (!old) throw Error("Room not found.");
    const p = authenticate(old, req.headers.authorization);
    if (!p)
      return json(401, {
        error: "This seat is unavailable. Rejoin from the lobby.",
      });
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(200, view(old, p.id));
    if (req.method === "POST" && url.pathname === "/api/action") {
      const g = beginAction(old, { revision: b.rev, revisionKey: "rev" });
      if (b.type === "leave") {
        if (g.phase !== "lobby")
          throw Error("You can leave your seat only in the lobby.");
        g.players = g.players.filter((x) => x.id !== p.id);
        if (g.host === p.id) g.host = g.players[0]?.id;
        g.rev++;
        if (!g.players.length) {
          rooms.delete(code);
          realtime?.publish();
          unlinkSync(`${dir}/${code}.json`);
        } else save(g);
        return json(200, { left: true });
      }
      move(g, p.id, b.type, b.data);
      save(g);
      return json(200, view(g, p.id));
    }
    return json(404, { error: "Not found" });
  } catch (e) {
    json(e.status || 400, { error: e.message });
  }
});
realtime = attachRoomSockets(server, {
  getRoom: (code) => rooms.get(code),
  view,
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Coup listening on " + server.address().port),
);
