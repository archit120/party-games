import { beginAction } from "../../packages/core/state.js";
import { sameBallot, hasVoted } from "../../packages/core/ballots.js";
import { createBudget } from "../../packages/ai/budget.js";
import http from "node:http";
import { addChat } from "./chat.js";
import { readFileSync } from "node:fs";
import {
  ensureDataDir,
  readJSON,
  writeJSON,
} from "../../packages/core/storage.js";
import {
  securityHeaders,
  sendJSON,
  readBody,
  serveCoreAsset,
} from "../../packages/core/http.js";
import {
  roomCode,
  authenticate,
  issueRecovery,
  recoverSeat,
  joinSeat,
} from "../../packages/core/rooms.js";
import { create, player, action, view as gameView } from "./game.js";
import {
  createAIController,
  flushComments,
  AI_NAMES,
  MAX_BOTS,
  DEFAULT_AI_MODEL,
} from "./ai.js";
const dir = process.env.DATA_DIR || "./data";
ensureDataDir(dir);
const file = `${dir}/rooms.json`;
let rooms = readJSON(file);
function save() {
  writeJSON(file, rooms);
}
const aiKey = process.env.OPENROUTER_API_KEY;
const aiModel = process.env.AI_MODEL || DEFAULT_AI_MODEL;
const reserveAIRequest = createBudget({
  file: `${dir}/ai-budget.json`,
  getRoom: (code) => rooms[code],
  saveRooms: save,
  dailyBudget: process.env.AI_DAILY_BUDGET_USD ?? 0.5,
});
const aiController = createAIController({
  getRooms: () => rooms,
  commit: (room) => {
    rooms[room.code] = room;
    save();
  },
  reserveRequest: reserveAIRequest,
  apiKey: aiKey,
  model: aiModel,
});
function view(room, id) {
  return {
    ...gameView(room, id),
    ai: { available: !!aiKey, model: aiModel, maxBots: MAX_BOTS },
  };
}
const rates = new Map();
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const send = (status, body) => sendJSON(res, status, body);
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") return send(200, { ok: true });
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      if (req.method === "POST") body = await readBody(req);
      if (req.method === "POST" && url.pathname === "/api/recover") {
        const g = rooms[String(body.code).toUpperCase()];
        const p = recoverSeat(g, body.key);
        if (!p)
          return send(401, {
            error:
              "This seat recovery link expired or was replaced. Ask the host for a new Recover seat link.",
          });
        return send(200, { code: g.code, token: p.token, name: p.name });
      }
      if (
        req.method === "POST" &&
        ["/api/create", "/api/join"].includes(url.pathname)
      ) {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        const r = rates.get(ip);
        if (r && now - r.time < 60000 && r.count >= 30)
          return send(429, {
            error: "Too many attempts. Try again in a minute.",
          });
        rates.set(
          ip,
          r && now - r.time < 60000
            ? { ...r, count: r.count + 1 }
            : { time: now, count: 1 },
        );
        let g, p;
        if (url.pathname === "/api/create") {
          if (Object.keys(rooms).length >= 1000) throw Error("Server is full.");
          const code = roomCode((code) => !!rooms[code]);
          g = create(code, body.name);
          p = g.players[0];
          rooms[code] = g;
        } else {
          g = rooms[String(body.code).toUpperCase()];
          if (!g) throw Error("Room unavailable. Check your invite link.");
          const joined = joinSeat(g, player(body.name), body.joinKey, 10);
          p = joined.player;
          if (!joined.added)
            return send(200, {
              code: g.code,
              token: p.token,
              state: view(g, p.id),
            });
          g.revision++;
        }
        g.updated = Date.now();
        save();
        return send(200, {
          code: g.code,
          token: p.token,
          state: view(g, p.id),
        });
      }
      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Z]{6})(?:\/(action|leave|bots|chat|kick|recovery))?$/,
      );
      if (!match) return send(404, { error: "Not found." });
      const g = rooms[match[1]];
      const p = authenticate(g, req.headers.authorization);
      if (!p || p.bot)
        return send(401, {
          error: "Room session unavailable. Rejoin from the lobby.",
        });
      aiController.touch(g.code);
      if (req.method === "GET" && !match[2]) return send(200, view(g, p.id));
      if (req.method === "POST" && match[2] === "recovery") {
        if (g.host !== p.id)
          return send(403, { error: "Only the host can recover a seat." });
        const target = g.players.find(
          (member) => member.id === body.target && !member.bot,
        );
        if (!target)
          return send(400, { error: "Choose a human player to recover." });
        const key = issueRecovery(target);
        save();
        return send(200, { key, name: target.name });
      }
      if (req.method === "POST" && match[2] === "kick") {
        if (p.id !== g.host || g.phase !== "lobby")
          return send(403, {
            error: "Only the host can remove players, before the game starts.",
          });
        if (body.target === g.host)
          return send(400, { error: "Use Leave room to leave your own seat." });
        const target = g.players.find((member) => member.id === body.target);
        if (!target)
          return send(400, { error: "That player is no longer in this room." });
        const copy = structuredClone(g);
        copy.players = copy.players.filter((member) => member.id !== target.id);
        copy.revision++;
        copy.updated = Date.now();
        rooms[g.code] = copy;
        save();
        return send(200, view(copy, p.id));
      }
      if (req.method === "POST" && match[2] === "chat") {
        const copy = structuredClone(g);
        if (copy.phase === "vote" && copy.voteStartRevision === undefined)
          copy.voteStartRevision =
            copy.revision - Object.keys(copy.votes ?? {}).length;
        addChat(copy, p.id, body.text);
        copy.updated = Date.now();
        copy.revision++;
        rooms[g.code] = copy;
        save();
        return send(200, view(copy, p.id));
      }
      if (req.method === "POST" && match[2] === "bots") {
        if (g.phase !== "lobby" || g.host !== p.id)
          return send(403, {
            error:
              "Only the host can manage AI players before the game starts.",
          });
        const copy = structuredClone(g);
        if (body.operation === "add") {
          if (!aiKey)
            return send(503, {
              error: "AI players are not configured on this server yet.",
            });
          if (
            copy.players.length >= 10 ||
            copy.players.filter((p) => p.bot).length >= MAX_BOTS
          )
            return send(400, {
              error: "The room is full or has reached the AI player limit.",
            });
          const name = AI_NAMES.find(
            (name) =>
              !copy.players.some(
                (p) => p.name.toLowerCase() === name.toLowerCase(),
              ),
          );
          const bot = player(name || `Guest ${copy.players.length} · AI`);
          bot.bot = true;
          copy.players.push(bot);
        } else if (body.operation === "remove") {
          if (!copy.players.some((p) => p.id === body.target && p.bot))
            return send(400, { error: "Choose an AI player to remove." });
          copy.players = copy.players.filter((p) => p.id !== body.target);
        } else if (
          body.operation === "comments" &&
          typeof body.enabled === "boolean"
        )
          copy.aiComments = body.enabled;
        else return send(400, { error: "Unknown AI setting." });
        copy.updated = Date.now();
        copy.revision++;
        rooms[g.code] = copy;
        save();
        return send(200, view(copy, p.id));
      }
      if (req.method === "POST" && match[2] === "leave") {
        if (g.phase !== "lobby")
          return send(409, {
            error:
              "The game has started. Your seat must be preserved; try Leave room again.",
          });
        const copy = structuredClone(g);
        copy.players = copy.players.filter((member) => member.id !== p.id);
        if (!copy.players.some((member) => !member.bot)) delete rooms[g.code];
        else {
          if (copy.host === p.id)
            copy.host = copy.players.find((member) => !member.bot).id;
          copy.revision++;
          copy.updated = Date.now();
          rooms[g.code] = copy;
        }
        save();
        return send(200, { left: true });
      }
      if (req.method === "POST" && match[2] === "action") {
        // Older open tabs have no electionId. Their revision must still belong
        // to this voting phase; only accepted ballots can change it here.
        const sameElection = sameBallot({
          submittedId: body.electionId,
          currentId: g.electionId ?? 0,
          submittedRevision: body.revision,
          currentRevision: g.revision,
          firstRevision:
            g.voteStartRevision ??
            g.revision - Object.keys(g.votes ?? {}).length,
          allowLegacy: true,
        });
        const ballot =
          body.type === "vote" && g.phase === "vote" && sameElection;
        if (body.type === "vote" && body.electionId !== undefined && !ballot)
          return send(409, {
            error: "This election has ended. The table is updating.",
          });
        if (ballot && hasVoted(g.votes, p.id)) return send(200, view(g, p.id));
        const copy = beginAction(g, {
          revision: body.revision,
          concurrent: ballot,
        });
        action(copy, p.id, body.type, body.payload);
        flushComments(copy);
        copy.updated = Date.now();
        copy.revision++;
        rooms[g.code] = copy;
        save();
        return send(200, view(copy, p.id));
      }
      return send(405, { error: "Method not allowed." });
    }
    if (serveCoreAsset(url.pathname, res)) return;
    const assets = {
      "/": ["index.html", "text/html"],
      "/app.js": ["app.js", "text/javascript"],
      "/style.css": ["style.css", "text/css"],
    };
    const asset = assets[url.pathname];
    if (!asset) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": asset[1],
      "Cache-Control": "no-cache",
    });
    res.end(readFileSync(new URL(`./public/${asset[0]}`, import.meta.url)));
  } catch (e) {
    send(e.status || 400, { error: e.message });
  }
});
setInterval(() => {
  const cutoff = Date.now() - 7 * 86400000;
  for (const [code, g] of Object.entries(rooms))
    if (g.updated < cutoff) delete rooms[code];
  save();
  rates.clear();
}, 3600000).unref();
server.listen(process.env.PORT || 3000, "0.0.0.0", () =>
  console.log(`Secret Hitler listening on ${server.address().port}`),
);
setInterval(() => {
  aiController.step().catch(() => {});
}, 500).unref();
