import { randomUUID } from "node:crypto";
export const privateDiscussion = (phase) =>
  ["president-discard", "chancellor-discard", "veto"].includes(phase);
export function addChat(g, id, text, now = Date.now()) {
  const p = g.players.find((p) => p.id === id && !p.bot);
  if (!p) throw Error("Only players at this table can chat.");
  if (!p.alive && g.phase !== "finished")
    throw Error(
      "Executed players can read chat, but must stay silent until the game ends.",
    );
  if (privateDiscussion(g.phase))
    throw Error(
      "Chat pauses during private legislation. Discuss the result after the policy is revealed.",
    );
  if (typeof text !== "string" || text.trim().length === 0 || text.length > 400)
    throw Error("Write a message of 1–400 characters.");
  const times = (p.chatTimes ?? []).filter((t) => now - t < 60000);
  if (times.length >= 15 || (times.length && now - times.at(-1) < 2000))
    throw Error("Please wait a moment before sending another message.");
  p.chatTimes = [...times, now];
  const message = {
    messageId: randomUUID(),
    seq: (g.chatSequence ?? 0) + 1,
    id: p.id,
    name: p.name,
    text: text.replace(/[\x00-\x1f\x7f]/g, " ").trim(),
    at: now,
    bot: false,
  };
  if (!message.text) throw Error("Write a message of 1–400 characters.");
  g.chatSequence = message.seq;
  g.chatMessages = [...(g.chatMessages ?? []), message].slice(-60);
  g.lastHumanChat = message;
  g.chatReplyPlan = { seq: message.seq, ids: chatReplyTargets(g, message) };
  return message;
}
export function tableMessages(g) {
  return [...(g.botComments ?? []), ...(g.chatMessages ?? [])]
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .slice(-30);
}
export function chatReplyTargets(g, msg) {
  if (g.chatReplyPlan?.seq === msg.seq) return g.chatReplyPlan.ids;
  const bots = g.players.filter((p) => p.bot && p.alive);
  if (!bots.length) return [];
  const words = msg.text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const mentioned = bots.filter((p) =>
    words.includes(p.name.split(" ·")[0].toLowerCase()),
  );
  const selected = [...mentioned];
  if (
    /\b(policy|policies|cards?|hand|lied|lying|bluff|forced|government|president|chancellor)\b/i.test(
      msg.text,
    )
  ) {
    const government =
      g.phase === "vote"
        ? [g.players[g.president]?.id, g.chancellor]
        : g.lastPolicy && !g.lastPolicy.chaos
          ? [g.lastPolicy.president, g.lastPolicy.chancellor]
          : [];
    selected.push(...bots.filter((p) => government.includes(p.id)));
  }
  const rotated = bots.map((_, i) => bots[(i + msg.seq - 1) % bots.length]);
  if (/\b(bots|ais|both|everyone)\b/i.test(msg.text)) selected.push(...rotated);
  if (!selected.length) selected.push(rotated[0]);
  return [...new Set(selected.map((p) => p.id))].slice(0, 2);
}
export function chatResponder(g, now = Date.now()) {
  const msg = g.lastHumanChat;
  if (
    g.aiComments === false ||
    !msg ||
    msg.seq <= (g.lastChatHandledSeq ?? 0) ||
    now - msg.at > 60000 ||
    now - msg.at < 1500 ||
    (g.lastAIChatSeq !== msg.seq && now - (g.lastAIChatAt ?? 0) < 10000)
  )
    return null;
  const targets = chatReplyTargets(g, msg);
  return (
    targets
      .map((id) => g.players.find((p) => p.id === id))
      .find((p) => p?.bot && p.alive && (p.lastChatReplySeq ?? 0) < msg.seq) ??
    null
  );
}
