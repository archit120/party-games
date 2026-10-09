import { castBallot, tallyBallots } from "../../packages/core/ballots.js";
import { randomUUID, randomInt } from "node:crypto";
import { pairs } from "./words.js";
const need = (ok, msg = "That move is not available.") => {
  if (!ok) throw Error(msg);
};
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const alive = (g) => g.players.filter((p) => p.alive);
const log = (g, text) => {
  g.log.push(text);
  g.log = g.log.slice(-100);
};
export function player(name) {
  need(
    typeof name === "string" &&
      name.trim().length > 0 &&
      name.trim().length <= 24,
    "Enter a name of 1–24 characters.",
  );
  return {
    id: randomUUID(),
    token: randomUUID(),
    name: name.trim(),
    alive: true,
  };
}
export function create(code, name) {
  const p = player(name);
  return {
    code,
    host: p.id,
    players: [p],
    phase: "lobby",
    revision: 0,
    round: 0,
    voteId: 0,
    settings: { undercover: 1, mrWhite: false },
    log: [],
    clues: [],
    updated: Date.now(),
  };
}
function finish(g, winner) {
  g.phase = "finished";
  g.winner = winner;
  log(
    g,
    winner === "civilians"
      ? "The civilians found every impostor."
      : winner === "mrWhite"
        ? "Mr. White guessed the civilian word."
        : "The impostors have taken over.",
  );
}
function victory(g) {
  const ps = alive(g),
    bad = ps.filter((p) => p.role !== "civilian").length;
  if (!bad) {
    finish(g, "civilians");
    return true;
  }
  if (bad >= ps.length - bad) {
    finish(g, "impostors");
    return true;
  }
  return false;
}
function round(g) {
  g.round++;
  g.phase = "clue";
  g.order = shuffle(alive(g).map((p) => p.id));
  g.turn = 0;
  g.votes = {};
  g.candidates = [];
  g.runoff = false;
  log(g, `Round ${g.round}: give one short clue, without saying your word.`);
}
function voting(g, candidates, runoff = false) {
  g.phase = "vote";
  g.voteId++;
  g.votes = {};
  g.candidates = candidates;
  g.runoff = runoff;
}
function countVotes(g) {
  const counts = Object.fromEntries(tallyBallots(g.votes, g.candidates));
  const max = Math.max(...Object.values(counts)),
    top = g.candidates.filter((id) => counts[id] === max);
  g.lastVote = { round: g.round, runoff: g.runoff, counts };
  if (top.length > 1) {
    if (g.runoff) {
      log(g, "The runoff tied. Nobody is eliminated. A new clue round begins.");
      round(g);
    } else {
      log(g, "A tie: discuss the tied players, then vote again.");
      voting(g, top, true);
    }
    return;
  }
  const p = g.players.find((p) => p.id === top[0]);
  p.alive = false;
  log(
    g,
    `${p.name} is eliminated: ${p.role === "civilian" ? "Civilian" : p.role === "undercover" ? "Undercover" : "Mr. White"}.`,
  );
  if (p.role === "mrWhite") {
    g.phase = "guess";
    g.guesser = p.id;
    return;
  }
  if (!victory(g)) round(g);
}
export function action(g, id, type, payload = {}) {
  const p = g.players.find((p) => p.id === id);
  need(p);
  if (type === "settings") {
    need(g.phase === "lobby" && g.host === id);
    need(
      Number.isInteger(payload.undercover) &&
        payload.undercover >= 1 &&
        payload.undercover <= 3 &&
        typeof payload.mrWhite === "boolean",
      "Choose 1–3 Undercover players and an optional Mr. White.",
    );
    g.settings = { undercover: payload.undercover, mrWhite: payload.mrWhite };
  } else if (type === "start") {
    need(g.phase === "lobby" && g.host === id);
    const n = g.players.length,
      bad = g.settings.undercover + Number(g.settings.mrWhite);
    need(
      n >= 3 && n <= 12 && bad < n - bad,
      "Civilians must outnumber impostors. Add players or reduce impostors.",
    );
    const index = randomInt(pairs.length),
      pair = [...pairs[index]];
    if (randomInt(2)) pair.reverse();
    g.words = pair;
    const roster = shuffle([...g.players]);
    for (let i = 0; i < roster.length; i++) {
      const member = roster[i];
      member.alive = true;
      member.role =
        i < g.settings.undercover
          ? "undercover"
          : i === g.settings.undercover && g.settings.mrWhite
            ? "mrWhite"
            : "civilian";
      member.word =
        member.role === "mrWhite"
          ? null
          : pair[member.role === "undercover" ? 1 : 0];
    }
    g.gameId = randomUUID();
    g.round = 0;
    g.clues = [];
    g.chatMessages = [];
    delete g.lastHumanChat;
    delete g.chatReplyPlan;
    delete g.lastChatHandledSeq;
    delete g.lastAIChatSeq;
    delete g.lastAIChatAt;
    g.log = [];
    delete g.lastVote;
    delete g.winner;
    delete g.guesser;
    round(g);
  } else if (type === "clue") {
    need(g.phase === "clue" && g.order[g.turn] === id && p.alive);
    need(
      typeof payload.text === "string" &&
        payload.text.trim().length > 0 &&
        payload.text.trim().length <= 80,
      "Give a clue of 1–80 characters.",
    );
    g.clues.push({ round: g.round, id, text: payload.text.trim() });
    g.turn++;
    if (g.turn === g.order.length) {
      g.phase = "discussion";
      log(
        g,
        "Discuss the clues. Each living player may open the ballot when ready.",
      );
    }
  } else if (type === "openVote") {
    need(g.phase === "discussion" && (p.alive || g.host === id));
    voting(
      g,
      alive(g).map((p) => p.id),
    );
  } else if (type === "vote") {
    need(g.phase === "vote" && p.alive);
    need(
      g.candidates.includes(payload.target) && payload.target !== id,
      "Vote for another eligible player.",
    );
    if (
      castBallot({
        votes: g.votes,
        voterId: id,
        value: payload.target,
        voters: alive(g).map((p) => p.id),
        choices: g.candidates.filter((target) => target !== id),
      })
    )
      countVotes(g);
  } else if (type === "guess") {
    need(g.phase === "guess" && g.guesser === id);
    need(
      typeof payload.word === "string" &&
        payload.word.trim().length > 0 &&
        payload.word.length <= 80,
      "Enter your guess.",
    );
    const normalize = (s) =>
      s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
    if (normalize(payload.word) === normalize(g.words[0])) finish(g, "mrWhite");
    else {
      log(g, `${p.name}'s guess was incorrect.`);
      delete g.guesser;
      if (!victory(g)) round(g);
    }
  } else if (type === "restart") {
    need(g.phase === "finished" && g.host === id);
    g.phase = "lobby";
    delete g.words;
    delete g.winner;
    delete g.guesser;
    g.clues = [];
    g.chatMessages = [];
    delete g.lastHumanChat;
    delete g.chatReplyPlan;
    delete g.lastChatHandledSeq;
    delete g.lastAIChatSeq;
    delete g.lastAIChatAt;
    g.log = [];
    g.votes = {};
    delete g.lastVote;
    for (const p of g.players) {
      p.alive = true;
      delete p.word;
      delete p.role;
      delete p.lastDiscussionRound;
      delete p.lastChatReplySeq;
    }
  } else need(false);
}
export function view(g, id) {
  const p = g.players.find((p) => p.id === id);
  need(p);
  return {
    code: g.code,
    host: g.host,
    phase: g.phase,
    revision: g.revision,
    round: g.round,
    voteId: g.voteId,
    gameId: g.gameId,
    settings: g.settings,
    me: {
      id: p.id,
      alive: p.alive,
      word: p.word ?? null,
      wordless: p.role === "mrWhite",
    },
    players: g.players.map((x) => ({
      id: x.id,
      name: x.name,
      alive: x.alive,
      bot: !!x.bot,
      botSource: x.botSource,
      ...(!x.alive || g.phase === "finished" ? { role: x.role } : {}),
      voted: Object.hasOwn(g.votes || {}, x.id),
    })),
    turn: g.phase === "clue" ? g.order[g.turn] : null,
    order: g.order,
    clues: g.clues,
    log: g.log,
    aiComments: g.aiComments !== false,
    chatMessages: (g.chatMessages ?? []).map(
      ({ messageId, id, name, text, at, bot, round }) => ({
        messageId,
        id,
        name,
        text,
        at,
        bot,
        round,
      }),
    ),
    candidates: g.phase === "vote" ? g.candidates : [],
    myVote: g.votes?.[id] ?? null,
    runoff: g.runoff,
    lastVote: g.lastVote,
    guesser: g.guesser,
    winner: g.winner,
    ...(g.phase === "finished" ? { words: g.words } : {}),
  };
}
