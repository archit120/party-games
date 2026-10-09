import {
  appendHumanChat,
  selectReplyTargets,
  nextChatResponder,
} from "../../packages/core/chat.js";
export const chatOpen = (phase) =>
  ["lobby", "discussion", "finished"].includes(phase);
export function addChat(g, id, text, now = Date.now()) {
  const p = g.players.find((p) => p.id === id && !p.bot);
  if (!p) throw Error("Only human players can send chat.");
  if (!p.alive && g.phase !== "finished")
    throw Error("Eliminated players can read but must stay silent.");
  if (!chatOpen(g.phase))
    throw Error("Chat opens during discussion. Finish clues or voting first.");
  const msg = appendHumanChat(g, id, text, now);
  g.chatReplyPlan = { seq: msg.seq, ids: selectReplyTargets(g, msg) };
  return msg;
}
export const chatResponder = (g, now = Date.now()) =>
  chatOpen(g.phase) ? nextChatResponder(g, selectReplyTargets, now) : null;
export function discussionSpeaker(g) {
  if (g.phase !== "discussion" || g.aiComments === false) return null;
  return (
    g.players
      .filter((p) => p.bot && p.alive)
      .slice(0, 2)
      .find((p) => p.lastDiscussionRound !== g.round) ?? null
  );
}
