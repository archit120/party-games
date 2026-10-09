import http from "node:http";
import { readFileSync } from "node:fs";
import { ensureDataDir, readJSON, writeJSON } from "./storage.js";
import { securityHeaders, sendJSON, readBody, serveCoreAsset } from "./http.js";
import {
  roomCode,
  authenticate,
  issueRecovery,
  recoverSeat,
  joinSeat,
} from "./rooms.js";
// Uses Secret Hitler's routes, persistent room map and per-seat bearer sessions.
export function startRoomServer({ game, title, publicDir, maxPlayers = 12 }) {
  const dir = ensureDataDir(process.env.DATA_DIR || "./data"),
    file = `${dir}/rooms.json`,
    rooms = readJSON(file),
    rates = new Map();
  const save = () => writeJSON(file, rooms);
  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    const send = (s, b) => sendJSON(res, s, b);
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health") return send(200, { ok: true });
      if (serveCoreAsset(url.pathname, res)) return;
      if (!url.pathname.startsWith("/api/")) {
        const assets = {
            "/": ["index.html", "text/html"],
            "/app.js": ["app.js", "text/javascript"],
            "/style.css": ["style.css", "text/css"],
          },
          a = assets[url.pathname];
        if (!a) return send(404, { error: "Not found." });
        res.writeHead(200, {
          "Content-Type": a[1],
          "Cache-Control": "no-cache",
        });
        return res.end(readFileSync(new URL(a[0], publicDir)));
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      if (req.method === "POST" && url.pathname === "/api/recover") {
        const g = rooms[String(body.code).toUpperCase()],
          p = recoverSeat(g, body.key);
        if (!p)
          return send(401, {
            error:
              "This recovery link expired or was replaced. Ask the host for a new link.",
          });
        return send(200, { code: g.code, token: p.token, name: p.name });
      }
      if (
        req.method === "POST" &&
        ["/api/create", "/api/join"].includes(url.pathname)
      ) {
        const now = Date.now(),
          ip = req.socket.remoteAddress;
        let r = rates.get(ip);
        if (!r || now - r.time >= 60000) {
          r = { time: now, count: 0 };
          rates.set(ip, r);
        }
        if (++r.count > 30)
          return send(429, {
            error: "Too many attempts. Try again in a minute.",
          });
        let g, p;
        if (url.pathname === "/api/create") {
          if (Object.keys(rooms).length >= 1000) throw Error("Server is full.");
          g = game.create(
            roomCode((code) => !!rooms[code]),
            body.name,
          );
          p = g.players[0];
        } else {
          const old = rooms[String(body.code).toUpperCase()];
          if (!old) throw Error("Room unavailable. Check your invite link.");
          g = structuredClone(old);
          const joined = joinSeat(
            g,
            game.player(body.name),
            body.joinKey,
            maxPlayers,
          );
          p = joined.player;
          if (joined.added) g.revision++;
        }
        g.updated = Date.now();
        rooms[g.code] = g;
        save();
        return send(200, {
          code: g.code,
          token: p.token,
          state: game.view(g, p.id),
        });
      }
      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Z]{6})(?:\/(action|leave|kick|recovery))?$/,
      );
      if (!match) return send(404, { error: "Not found." });
      const g = rooms[match[1]],
        p = authenticate(g, req.headers.authorization);
      if (!p)
        return send(401, {
          error: "Room session unavailable. Ask the host for a recovery link.",
        });
      if (req.method === "GET" && !match[2])
        return send(200, game.view(g, p.id));
      if (req.method !== "POST")
        return send(405, { error: "Method not allowed." });
      const copy = structuredClone(g);
      if (match[2] === "recovery") {
        if (g.host !== p.id)
          return send(403, { error: "Only the host can recover a seat." });
        const target = copy.players.find((p) => p.id === body.target);
        if (!target) throw Error("Choose a player to recover.");
        const key = issueRecovery(target);
        rooms[g.code] = copy;
        save();
        return send(200, { key, name: target.name });
      }
      if (match[2] === "leave" || match[2] === "kick") {
        if (g.phase !== "lobby")
          return send(409, { error: "Seats must be preserved during a game." });
        const target = match[2] === "leave" ? p.id : body.target;
        if (match[2] === "kick" && (g.host !== p.id || target === g.host))
          return send(403, {
            error: "Only the host can remove another lobby player.",
          });
        if (!copy.players.some((p) => p.id === target))
          throw Error("Player not found.");
        copy.players = copy.players.filter((p) => p.id !== target);
        if (!copy.players.length) delete rooms[g.code];
        else {
          if (target === g.host) copy.host = copy.players[0].id;
          copy.revision++;
          copy.updated = Date.now();
          rooms[g.code] = copy;
        }
        save();
        return send(
          200,
          match[2] === "leave" ? { left: true } : game.view(copy, p.id),
        );
      }
      if (match[2] === "action") {
        const vote =
          body.type === "vote" &&
          g.phase === "vote" &&
          body.voteId === g.voteId &&
          body.gameId === g.gameId;
        if (body.type === "vote" && !vote)
          return send(409, {
            error: "This ballot has ended. The table is updating.",
          });
        if (vote && Object.hasOwn(g.votes, p.id))
          return send(200, game.view(g, p.id));
        if (!vote && body.revision !== g.revision)
          return send(409, { error: "The table changed. Please try again." });
        game.action(copy, p.id, body.type, body.payload);
        copy.revision++;
        copy.updated = Date.now();
        rooms[g.code] = copy;
        save();
        return send(200, game.view(copy, p.id));
      }
      return send(405, { error: "Method not allowed." });
    } catch (e) {
      send(e.status || 400, { error: e.message });
    }
  });
  setInterval(() => {
    for (const [code, g] of Object.entries(rooms))
      if (g.updated < Date.now() - 7 * 86400000) delete rooms[code];
    for (const [ip, r] of rates)
      if (r.time < Date.now() - 60000) rates.delete(ip);
    save();
  }, 60000).unref();
  server.listen(process.env.PORT || 3000, "0.0.0.0", () =>
    console.log(`${title} listening on ${server.address().port}`),
  );
  return server;
}
