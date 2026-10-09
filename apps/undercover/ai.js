import {
  ACTION_SYSTEM,
  CLUE_REVIEW_SYSTEM,
  CHAT_SYSTEM,
} from "./ai-prompts.js";
import { chatResponder, discussionSpeaker, chatOpen } from "./chat.js";
import { appendBotChat, selectReplyTargets } from "../../packages/core/chat.js";
import { randomInt } from "node:crypto";
import { completeJSON, DEFAULT_AI_MODEL } from "../../packages/ai/provider.js";
import { createActivity } from "../../packages/ai/activity.js";
import { action, view } from "./game.js";
export {
  MAX_BOTS,
  AI_NAMES,
  DEFAULT_AI_MODEL,
} from "../../packages/ai/provider.js";
export function legalChoices(v) {
  if (v.phase === "guess" && v.guesser === v.me.id) return [{ type: "guess" }];
  if (!v.me.alive) return [];
  if (v.phase === "clue" && v.turn === v.me.id) return [{ type: "clue" }];
  if (v.phase === "vote" && !v.myVote)
    return v.candidates
      .filter((id) => id !== v.me.id)
      .map((target) => ({ type: "vote", payload: { target } }));
  return [];
}
export const decisionKey = (v) =>
  legalChoices(v).length
    ? [v.gameId, v.round, v.phase, v.voteId, v.turn, v.guesser, v.me.id].join(
        "|",
      )
    : null;
export function decisionContext(v) {
  return {
    you: { id: v.me.id, word: v.me.word, wordless: v.me.wordless },
    phase: v.phase,
    round: v.round,
    players: v.players.map(({ id, name, alive, role }) => ({
      id,
      name,
      alive,
      ...(role ? { revealedRole: role } : {}),
    })),
    clues: v.clues.slice(-36),
    publicHistory: v.log.slice(-12),
    lastVote: v.lastVote,
    discussion: (v.chatMessages ?? []).slice(-20),
    playerClues: v.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      clues: v.clues.filter((c) => c.id === p.id).slice(-6),
    })),
    choices: legalChoices(v).map((c, index) => ({ index, ...c })),
  };
}
const normalize = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function validate(v, decision) {
  const choices = legalChoices(v),
    choice = decision?.choice;
  const legal = choices.find(
    (c) =>
      c.type === choice?.type &&
      (c.type !== "vote" || c.payload.target === choice.payload?.target),
  );
  if (!legal) throw Error("Illegal AI action");
  if (choice.type !== "vote") {
    const text = choice.payload?.[choice.type === "clue" ? "text" : "word"];
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 80 ||
      /[\x00-\x1f]/.test(text)
    )
      throw Error("Invalid AI text");
    if (choice.type === "clue" && !/^\p{L}+(?:[-’']\p{L}+)?$/u.test(text))
      throw Error("AI clues must be one word");
    if (
      choice.type === "clue" &&
      v.clues
        .filter((c) => c.id === v.me.id)
        .slice(-3)
        .some((c) => normalize(c.text) === normalize(text))
    )
      throw Error("AI repeated its clue");
    if (
      choice.type === "clue" &&
      v.me.word &&
      normalize(text).includes(normalize(v.me.word))
    )
      throw Error("AI clue disclosed its word");
  }
  return decision;
}
export async function chooseWithModel(v, options = {}) {
  const context = decisionContext(v),
    { parsed, cost } = await completeJSON({
      ...options,
      system: ACTION_SYSTEM,
      reasoningEffort: "medium",
      context,
      title: "Undercover - Between the Lines",
      maxTokens: 700,
    });
  if (!Number.isInteger(parsed.choice) || !context.choices[parsed.choice])
    throw Error("Illegal AI choice");
  const chosen = legalChoices(v)[parsed.choice];
  const choice =
    chosen.type === "vote"
      ? chosen
      : {
          type: chosen.type,
          payload: {
            [chosen.type === "clue" ? "text" : "word"]:
              typeof parsed.text === "string"
                ? parsed.text.trim()
                : parsed.text,
          },
        };
  if (chosen.type === "clue" && options.reserveReview) {
    const candidates = [
      ...new Set([
        parsed.text,
        ...(Array.isArray(parsed.clues) ? parsed.clues : []),
      ]),
    ]
      .filter((text) => {
        try {
          validate(v, { choice: { type: "clue", payload: { text } } });
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 4);
    if (!candidates.length) throw Error("No safe one-word clues");
    const reservation = options.reserveReview();
    if (!reservation) throw Error("Clue review budget unavailable");
    let reviewed;
    try {
      reviewed = await completeJSON({
        ...options,
        system: CLUE_REVIEW_SYSTEM,
        reasoningEffort: "medium",
        context: {
          word: v.me.word,
          wordless: v.me.wordless,
          publicClues: v.clues.slice(-24),
          candidates,
        },
        title: "Undercover - Clue quality",
        temperature: 0,
        maxTokens: 100,
        timeout: 6000,
      });
    } finally {
      reservation.finish(reviewed?.cost);
    }
    if (
      !Number.isInteger(reviewed.parsed.index) ||
      !candidates[reviewed.parsed.index]
    )
      throw Error("Clue quality check rejected candidates");
    choice.payload.text = candidates[reviewed.parsed.index];
  }
  return validate(v, { choice, cost, source: "model" });
}
export function basicDecision(v) {
  const choices = legalChoices(v);
  if (!choices.length) throw Error("No legal AI action");
  let choice = choices[randomInt(choices.length)];
  if (choice.type === "clue") {
    const candidates = [
      "contrast",
      "ritual",
      "mood",
      "pattern",
      "memory",
      "occasion",
      "balance",
      "detail",
      "setting",
      "change",
      "habit",
      "moment",
    ];
    const used = v.clues
      .filter((c) => c.id === v.me.id)
      .slice(-3)
      .map((c) => normalize(c.text));
    const available = candidates.filter(
      (c) =>
        !used.includes(normalize(c)) &&
        (!v.me.word || !normalize(c).includes(normalize(v.me.word))),
    );
    choice = {
      type: "clue",
      payload: { text: available[randomInt(available.length)] },
    };
  } else if (choice.type === "guess") {
    const text = v.clues.at(-1)?.text || "unknown";
    choice = {
      type: "guess",
      payload: { word: text.match(/[\p{L}]+/u)?.[0] || "unknown" },
    };
  }
  return validate(v, { choice, source: "basic" });
}
export function createAIController({
  getRooms,
  commit,
  reserveRequest,
  apiKey,
  model = DEFAULT_AI_MODEL,
  decide = chooseWithModel,
  chat = chatWithModel,
  now = Date.now,
  minDelay = 1600,
  maxConcurrent = 2,
}) {
  const activity = createActivity({ now, maxConcurrent });
  async function step() {
    for (const g of Object.values(getRooms())) {
      if (!activity.eligible(g.code)) continue;
      const reply = chatResponder(g, now()),
        speaker = reply ?? discussionSpeaker(g);
      if (speaker && g.aiComments !== false) {
        const event = reply
          ? { kind: "reply", ...g.lastHumanChat }
          : { kind: "discussion", round: g.round, at: g.updated };
        if (event.kind === "discussion" && now() - event.at < 1500) continue;
        activity.workers.set(g.code, speaker.id);
        const gameId = g.gameId,
          phase = g.phase,
          round = g.round;
        const job = (async () => {
          let result, reservation;
          try {
            reservation = apiKey ? reserveRequest(g.code) : null;
            if (reservation) {
              try {
                result = await chat(view(g, speaker.id), {
                  apiKey,
                  model,
                  replyTo: reply
                    ? { name: event.name, text: event.text }
                    : null,
                });
              } catch {
              } finally {
                reservation.finish(result?.cost);
              }
            }
            const current = getRooms()[g.code];
            if (
              !current ||
              current.gameId !== gameId ||
              current.phase !== phase ||
              current.round !== round ||
              !chatOpen(current.phase)
            )
              return;
            const copy = structuredClone(current),
              member = copy.players.find((p) => p.id === speaker.id);
            if (!member?.alive || copy.aiComments === false) return;
            if (reply) {
              if (copy.lastHumanChat?.seq !== event.seq) return;
              member.lastChatReplySeq = event.seq;
              copy.lastAIChatSeq = event.seq;
              copy.lastAIChatAt = now();
              if (
                selectReplyTargets(copy, event).every(
                  (id) =>
                    (copy.players.find((p) => p.id === id)?.lastChatReplySeq ??
                      0) >= event.seq,
                )
              )
                copy.lastChatHandledSeq = event.seq;
            } else member.lastDiscussionRound = round;
            if (result?.text) {
              appendBotChat(copy, member, result.text, now(), {
                round,
                replyTo: reply ? event.messageId : undefined,
              });
              copy.revision++;
            }
            copy.updated = now();
            commit(copy);
          } finally {
            activity.workers.delete(g.code);
          }
        })();
        job.catch(() => {});
        continue;
      }
      if (["lobby", "finished", "discussion"].includes(g.phase)) continue;
      const p = g.players.find((p) => p.bot && decisionKey(view(g, p.id)));
      if (!p) continue;
      const v = view(g, p.id),
        key = decisionKey(v),
        scheduled = activity.due.get(g.code);
      if (!scheduled || scheduled.key !== key) {
        activity.due.set(g.code, { key, time: now() + minDelay });
        continue;
      }
      if (now() < scheduled.time) continue;
      activity.workers.set(g.code, p.id);
      const job = (async () => {
        let decision, reservation;
        try {
          reservation = apiKey ? reserveRequest(g.code) : null;
          try {
            decision = reservation
              ? validate(
                  v,
                  await decide(v, {
                    apiKey,
                    model,
                    reserveReview: () => reserveRequest(g.code),
                  }),
                )
              : basicDecision(v);
          } catch {
            decision = basicDecision(v);
          } finally {
            reservation?.finish(decision?.cost);
          }
          const current = getRooms()[g.code];
          if (
            !current ||
            !current.players.some((p) => p.id === v.me.id) ||
            decisionKey(view(current, v.me.id)) !== key
          )
            return;
          const copy = structuredClone(current);
          action(copy, p.id, decision.choice.type, decision.choice.payload);
          copy.players.find((x) => x.id === p.id).botSource = decision.source;
          copy.revision++;
          copy.updated = now();
          commit(copy);
        } finally {
          activity.workers.delete(g.code);
          activity.due.delete(g.code);
        }
      })();
      job.catch(() => {});
    }
    activity.prune();
  }
  return { touch: activity.touch, step };
}

export async function chatWithModel(v, options = {}) {
  const { parsed, cost } = await completeJSON({
    ...options,
    system: CHAT_SYSTEM,
    reasoningEffort: "medium",
    context: { ...decisionContext(v), replyTo: options.replyTo ?? null },
    title: "Undercover - Table talk",
    maxTokens: 250,
  });
  const text =
    typeof parsed.text === "string"
      ? parsed.text.replace(/[\x00-\x1f\x7f]/g, " ").trim()
      : "";
  if (!text || text.length > 220) throw Error("Invalid table talk");
  if (
    v.phase !== "finished" &&
    v.me.word &&
    normalize(text).includes(normalize(v.me.word))
  )
    throw Error("Table talk disclosed its word");
  return { text, cost };
}
