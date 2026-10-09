import { randomUUID } from "node:crypto";
export function appendHumanChat(g, id, text, now = Date.now()) {
  const p = g.players.find((p) => p.id === id && !p.bot);
  if (!p) throw Error("Only players at this table can chat.");
  if (typeof text !== "string" || !text.trim() || text.length > 400)
    throw Error("Write a message of 1–400 characters.");
  const clean = text.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (!clean) throw Error("Write a message of 1–400 characters.");
  const times = (p.chatTimes ?? []).filter((t) => now - t < 60000);
  if (times.length >= 15 || (times.length && now - times.at(-1) < 2000))
    throw Error("Please wait a moment before sending another message.");
  const message = {
    messageId: randomUUID(),
    seq: (g.chatSequence ?? 0) + 1,
    id: p.id,
    name: p.name,
    text: clean,
    at: now,
    bot: false,
  };
  p.chatTimes = [...times, now];
  g.chatSequence = message.seq;
  g.chatMessages = [...(g.chatMessages ?? []), message].slice(-60);
  g.lastHumanChat = message;
  return message;
}
export function selectReplyTargets(g, msg, extraIds = []) {
  if (g.chatReplyPlan?.seq === msg.seq) return g.chatReplyPlan.ids;
  const bots = g.players.filter((p) => p.bot && p.alive);
  if (!bots.length) return [];
  const words = msg.text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const selected = bots.filter((p) =>
    words.includes(p.name.split(" ·")[0].toLowerCase()),
  );
  selected.push(...bots.filter((p) => extraIds.includes(p.id)));
  const rotated = bots.map((_, i) => bots[(i + msg.seq - 1) % bots.length]);
  if (/\b(bots|ais|both|everyone)\b/i.test(msg.text)) selected.push(...rotated);
  if (!selected.length) selected.push(rotated[0]);
  return [...new Set(selected.map((p) => p.id))].slice(0, 2);
}
export function nextChatResponder(g, targets, now = Date.now()) {
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
  return (
    targets(g, msg)
      .map((id) => g.players.find((p) => p.id === id))
      .find((p) => p?.bot && p.alive && (p.lastChatReplySeq ?? 0) < msg.seq) ??
    null
  );
}
export function appendBotChat(g, p, text, now = Date.now(), extra = {}) {
  const message = {
    messageId: randomUUID(),
    id: p.id,
    name: p.name,
    text,
    at: now,
    bot: true,
    ...extra,
  };
  g.chatMessages = [...(g.chatMessages ?? []), message].slice(-60);
  return message;
}
