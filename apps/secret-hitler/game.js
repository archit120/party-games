import { randomInt, randomUUID } from "node:crypto";
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    let j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const assert = (ok, msg) => {
  if (!ok) throw Error(msg);
};
export const powers = (n) =>
  n <= 6
    ? [null, null, "peek", "execute", "execute", null]
    : n <= 8
      ? [null, "investigate", "special", "execute", "execute", null]
      : ["investigate", "investigate", "special", "execute", "execute", null];
export const alive = (g) => g.players.filter((p) => p.alive);
export function create(code, name) {
  const p = player(name);
  return {
    code,
    host: p.id,
    players: [p],
    phase: "lobby",
    gameId: 1,
    log: [],
    updated: Date.now(),
    revision: 0,
  };
}
export function player(name) {
  assert(
    typeof name === "string" &&
      name.trim().length > 0 &&
      name.trim().length <= 24,
    "Use a name of 1–24 characters.",
  );
  return {
    id: randomUUID(),
    token: randomUUID(),
    name: name.trim(),
    alive: true,
    notes: [],
  };
}
function log(g, text) {
  g.log.push(text);
}
function refill(g) {
  if (g.deck.length < 3) {
    g.deck = shuffle([...g.deck, ...g.discard]);
    g.discard = [];
  }
}
function nextIndex(g, i) {
  do {
    i = (i + 1) % g.players.length;
  } while (!g.players[i].alive);
  return i;
}
function next(g) {
  g.president = nextIndex(g, g.resume ?? g.president);
  g.resume = null;
  g.chancellor = null;
  g.phase = "nominate";
  g.power = null;
  g.hand = [];
  g.votes = {};
  g.vetoDenied = false;
}
function win(g, team, reason) {
  g.phase = "finished";
  g.winner = team;
  g.reason = reason;
  log(g, `${team} win: ${reason}`);
}
export function eligible(g) {
  return alive(g)
    .filter(
      (p) =>
        p.id !== g.players[g.president].id &&
        p.id !== g.last?.chancellor &&
        (alive(g).length <= 5 || p.id !== g.last?.president),
    )
    .map((p) => p.id);
}
function enact(g, policy, chaos = false) {
  g[policy]++;
  g.lastPolicy = {
    number: g.Liberal + g.Fascist,
    electionId: g.electionId,
    policy,
    chaos,
    president: chaos ? null : g.players[g.president].id,
    chancellor: chaos ? null : g.chancellor,
  };
  g.tracker = 0;
  log(g, `${policy} policy enacted${chaos ? " by chaos" : ""}.`);
  refill(g);
  if (g.Liberal === 5) return win(g, "Liberals", "Five Liberal policies.");
  if (g.Fascist === 6) return win(g, "Fascists", "Six Fascist policies.");
  const power =
    policy === "Fascist" && !chaos
      ? powers(g.players.length)[g.Fascist - 1]
      : null;
  if (power) {
    g.power = power;
    g.phase = "power";
  } else next(g);
}
function fail(g) {
  g.tracker++;
  if (g.tracker === 3) {
    g.last = null;
    enact(g, g.deck.shift(), true);
  } else {
    refill(g);
    next(g);
  }
}
export function action(g, id, type, payload = {}) {
  const p = g.players.find((p) => p.id === id);
  assert(p, "Unknown player.");
  if (type === "end-game") {
    assert(g.host === id, "Only the host can end the game.");
    assert(!["lobby", "finished"].includes(g.phase), "There is no active game to end.");
    g.phase = "finished";
    g.winner = null;
    g.reason = "The host ended this game. No winner was declared.";
    g.discard.push(...g.hand);
    g.hand = [];
    g.power = null;
    log(g, g.reason);
    return;
  }
  if (type === "restart") {
    assert(
      g.phase === "finished" && g.host === id,
      "Only the host can play again after the game ends.",
    );
    const fresh = {
      code: g.code,
      host: g.host,
      phase: "lobby",
      gameId: (g.gameId ?? 1) + 1,
      revision: g.revision,
      updated: g.updated,
      electionId: g.electionId ?? 0,
      aiComments: g.aiComments !== false,
      aiRequests: 0,
      log: [],
      players: g.players.map(
        ({ id, token, name, bot, chatTimes, joinKey }) => ({
          id,
          token,
          name,
          alive: true,
          notes: [],
          ...(bot ? { bot: true } : {}),
          ...(chatTimes ? { chatTimes } : {}),
          ...(joinKey ? { joinKey } : {}),
        }),
      ),
    };
    for (const key of Object.keys(g)) delete g[key];
    Object.assign(g, fresh);
    return;
  }
  if (type === "start") {
    assert(
      g.phase === "lobby" && g.host === id,
      "Only the host can start the lobby.",
    );
    assert(
      g.players.length >= 5 && g.players.length <= 10,
      "You need 5–10 players.",
    );
    let fascists = Math.floor((g.players.length - 3) / 2);
    const roles = shuffle([
      "Hitler",
      ...Array(fascists).fill("Fascist"),
      ...Array(g.players.length - fascists - 1).fill("Liberal"),
    ]);
    g.players.forEach((p, i) => (p.role = roles[i]));
    Object.assign(g, {
      deck: shuffle([
        ...Array(6).fill("Liberal"),
        ...Array(11).fill("Fascist"),
      ]),
      discard: [],
      hand: [],
      Liberal: 0,
      Fascist: 0,
      tracker: 0,
      last: null,
      investigated: [],
      votes: {},
      president: randomInt(g.players.length),
      chancellor: null,
      phase: "nominate",
      vetoDenied: false,
    });
    log(g, "The game begins. Roles have been dealt.");
    return;
  }
  assert(
    p.alive && g.phase !== "lobby" && g.phase !== "finished",
    "You cannot act now.",
  );
  const president = g.players[g.president];
  if (type === "nominate") {
    assert(
      g.phase === "nominate" && id === president.id,
      "The President must nominate.",
    );
    assert(
      eligible(g).includes(payload.target),
      "That player is not eligible.",
    );
    g.chancellor = payload.target;
    g.electionId = (g.electionId ?? 0) + 1;
    g.votes = {};
    g.phase = "vote";
    g.voteStartRevision = g.revision + 1;
    log(
      g,
      `${president.name} nominates ${g.players.find((p) => p.id === payload.target).name}.`,
    );
  } else if (type === "vote") {
    assert(
      g.phase === "vote" &&
        typeof payload.yes === "boolean" &&
        !(id in g.votes),
      "You cannot vote now.",
    );
    g.votes[id] = payload.yes;
    if (Object.keys(g.votes).length === alive(g).length) {
      g.lastVote = {
        votes: { ...g.votes },
        president: president.id,
        chancellor: g.chancellor,
      };
      const passed =
        Object.values(g.votes).filter(Boolean).length > alive(g).length / 2;
      log(
        g,
        `Election ${passed ? "passes" : "fails"}: ${alive(g)
          .map((p) => `${p.name} ${g.votes[p.id] ? "Ja" : "Nein"}`)
          .join(", ")}.`,
      );
      if (!passed) return fail(g);
      g.last = { president: president.id, chancellor: g.chancellor };
      if (
        g.Fascist >= 3 &&
        g.players.find((p) => p.id === g.chancellor).role === "Hitler"
      )
        return win(
          g,
          "Fascists",
          "Hitler was elected Chancellor after three Fascist policies.",
        );
      g.hand = g.deck.splice(0, 3);
      g.phase = "president-discard";
    }
  } else if (type === "discard") {
    assert(
      (g.phase === "president-discard" && id === president.id) ||
        (g.phase === "chancellor-discard" && id === g.chancellor),
      "Only the current legislator can discard.",
    );
    assert(
      Number.isInteger(payload.index) &&
        payload.index >= 0 &&
        payload.index < g.hand.length,
      "Choose a policy.",
    );
    g.discard.push(g.hand.splice(payload.index, 1)[0]);
    if (g.phase === "president-discard") g.phase = "chancellor-discard";
    else {
      const policy = g.hand.pop();
      enact(g, policy);
    }
  } else if (type === "veto") {
    assert(
      g.phase === "chancellor-discard" &&
        id === g.chancellor &&
        g.Fascist >= 5 &&
        !g.vetoDenied,
      "Veto is unavailable.",
    );
    g.phase = "veto";
  } else if (type === "respond-veto") {
    assert(
      g.phase === "veto" &&
        id === president.id &&
        typeof payload.yes === "boolean",
      "The President must respond.",
    );
    log(g, `President ${payload.yes ? "accepts" : "rejects"} the veto.`);
    if (payload.yes) {
      g.discard.push(...g.hand);
      g.hand = [];
      fail(g);
    } else {
      g.vetoDenied = true;
      g.phase = "chancellor-discard";
    }
  } else if (type === "power") {
    assert(
      g.phase === "power" && id === president.id,
      "The President must use the power.",
    );
    if (g.power === "peek") {
      p.notes.push(
        `Policy peek: ${g.deck.slice(0, 3).join(", ")} (top first).`,
      );
      log(g, `${p.name} peeked at the next three policies.`);
      next(g);
      return;
    }
    const target = g.players.find((p) => p.id === payload.target);
    assert(
      target && target.alive && target.id !== id,
      "Choose another living player.",
    );
    if (g.power === "investigate") {
      assert(
        !g.investigated.includes(target.id),
        "That player was already investigated.",
      );
      g.investigated.push(target.id);
      p.notes.push(
        `${target.name} has ${target.role === "Liberal" ? "Liberal" : "Fascist"} party membership.`,
      );
      log(g, `${p.name} investigated ${target.name}.`);
      next(g);
    } else if (g.power === "execute") {
      target.alive = false;
      log(g, `${p.name} executed ${target.name}.`);
      if (target.role === "Hitler") win(g, "Liberals", "Hitler was executed.");
      else next(g);
    } else if (g.power === "special") {
      g.resume = g.president;
      g.president = g.players.indexOf(target);
      g.chancellor = null;
      g.phase = "nominate";
      g.power = null;
      g.votes = {};
      g.vetoDenied = false;
      log(
        g,
        `${p.name} called a special election with ${target.name} as President.`,
      );
    }
  } else throw Error("Unknown action.");
}
export function view(g, id) {
  const me = g.players.find((p) => p.id === id);
  assert(me, "Unknown player.");
  const revealed = g.phase === "finished";
  const knows =
    me.role === "Fascist" || (me.role === "Hitler" && g.players.length <= 6);
  return {
    code: g.code,
    gameId: g.gameId ?? 1,
    host: g.host,
    revision: g.revision,
    electionId: g.electionId ?? 0,
    phase: g.phase,
    aiComments: g.aiComments !== false,
    botComments: g.botComments ?? [],
    chatMessages: g.chatMessages ?? [],
    roleCounts:
      g.players.length >= 5
        ? {
            Liberal:
              g.players.length - Math.floor((g.players.length - 3) / 2) - 1,
            Fascist: Math.floor((g.players.length - 3) / 2),
            Hitler: 1,
          }
        : null,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      bot: p.bot === true,
      ...(p.bot ? { botSource: p.botSource ?? null } : {}),
      ...(revealed ? { role: p.role } : {}),
    })),
    me: {
      id: me.id,
      role: me.role,
      notes: me.notes,
      allies: knows
        ? g.players
            .filter((p) => p.id !== id && p.role !== "Liberal")
            .map((p) => ({ name: p.name, role: p.role }))
        : [],
    },
    president: g.players[g.president]?.id,
    chancellor: g.chancellor,
    Liberal: g.Liberal ?? 0,
    Fascist: g.Fascist ?? 0,
    tracker: g.tracker ?? 0,
    powers: powers(g.players.length),
    eligible: g.phase === "nominate" ? eligible(g) : [],
    voted: Object.keys(g.votes ?? {}),
    lastVote: g.lastVote,
    lastPolicy: g.lastPolicy ?? null,
    hand:
      (g.phase === "president-discard" && g.players[g.president].id === id) ||
      (["chancellor-discard", "veto"].includes(g.phase) && g.chancellor === id)
        ? g.hand
        : [],
    power: g.power,
    investigated: g.investigated ?? [],
    vetoDenied: g.vetoDenied,
    deckCount: g.deck?.length ?? 17,
    discardCount: g.discard?.length ?? 0,
    log: g.log,
    winner: g.winner,
    reason: g.reason,
  };
}
