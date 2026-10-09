import {
  appendHumanChat,
  selectReplyTargets,
  nextChatResponder,
} from "../../packages/core/chat.js";
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
  const message = appendHumanChat(g, id, text, now);
  g.chatReplyPlan = { seq: message.seq, ids: chatReplyTargets(g, message) };
  return message;
}
export function tableMessages(g) {
  return [...(g.botComments ?? []), ...(g.chatMessages ?? [])]
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .slice(-30);
}
export function chatReplyTargets(g, msg) {
  const government =
    /\b(policy|policies|cards?|hand|lied|lying|bluff|forced|government|president|chancellor)\b/i.test(
      msg.text,
    )
      ? g.phase === "vote"
        ? [g.players[g.president]?.id, g.chancellor]
        : g.lastPolicy && !g.lastPolicy.chaos
          ? [g.lastPolicy.president, g.lastPolicy.chancellor]
          : []
      : [];
  return selectReplyTargets(g, msg, government);
}
export function chatResponder(g, now = Date.now()) {
  return nextChatResponder(g, chatReplyTargets, now);
}
