import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, action, view } from "../game.js";
import { addChat, chatResponder } from "../chat.js";
import { chatWithModel, createAIController, chooseWithModel } from "../ai.js";
function setup() {
  const g = create("ABCDEF", "Human");
  for (const name of ["Ada · AI", "Basil · AI"]) {
    const p = player(name);
    p.bot = true;
    g.players.push(p);
  }
  return g;
}
const settle = () => new Promise((r) => setTimeout(r, 10));
test("chat permissions, rate limits and private metadata filtering", () => {
  const g = setup(),
    t = 100000;
  addChat(g, g.host, "Ada, hello", t);
  assert.equal(chatResponder(g, t + 2000).id, g.players[1].id);
  assert.throws(() => addChat(g, g.host, "again", t + 1));
  assert.throws(() => addChat(g, g.players[1].id, "bot", t + 3000));
  g.phase = "vote";
  assert.throws(() => addChat(g, g.host, "vote leak", t + 3000));
  g.phase = "discussion";
  g.players[0].alive = false;
  assert.throws(() => addChat(g, g.host, "dead", t + 3000));
  g.phase = "finished";
  addChat(g, g.host, "good game", t + 3000);
  const v = view(g, g.host);
  assert.equal(v.chatMessages.length, 2);
  assert.equal(v.chatMessages[0].seq, undefined);
  assert.equal(v.lastHumanChat, undefined);
  assert.equal(v.players[0].chatTimes, undefined);
});
test("named replies publish once, do not trigger bot loops, and use shared budget", async () => {
  let g = setup(),
    now = 100000,
    calls = 0;
  addChat(g, g.host, "Ada, thoughts?", now);
  now += 2000;
  const ai = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    now: () => now,
    chat: async (v, opts) => {
      calls++;
      assert.equal(v.me.id, g.players[1].id);
      assert.equal(opts.replyTo.text, "Ada, thoughts?");
      return { text: "Let us hear all the clues first." };
    },
  });
  ai.touch(g.code);
  await ai.step();
  await settle();
  await ai.step();
  assert.equal(calls, 1);
  assert.equal(g.chatMessages.length, 2);
  assert.equal(g.chatMessages[1].bot, true);
});
test("stale discussion replies cannot appear during voting or a rematch", async () => {
  for (const transition of ["vote", "rematch"]) {
    let g = setup(),
      now = 100000,
      resolve;
    g.phase = "discussion";
    g.gameId = "old";
    g.round = 1;
    g.updated = now - 2000;
    const ai = createAIController({
      getRooms: () => ({ [g.code]: g }),
      commit: (x) => (g = x),
      apiKey: "test",
      reserveRequest: () => ({ finish() {} }),
      now: () => now,
      chat: () => new Promise((r) => (resolve = r)),
    });
    ai.touch(g.code);
    await ai.step();
    if (transition === "vote") g.phase = "vote";
    else g.gameId = "new";
    resolve({ text: "This must not appear." });
    await settle();
    assert.equal(g.chatMessages, undefined);
  }
});
test("chat context omits other words and rejects own-word disclosure", async () => {
  const g = setup();
  action(g, g.host, "start");
  g.phase = "discussion";
  const p = g.players[1],
    v = view(g, p.id);
  let input;
  const fetchImpl = async (u, o) => {
    input = JSON.parse(JSON.parse(o.body).messages[1].content);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ text: p.word }) } }],
      }),
    };
  };
  await assert.rejects(
    () => chatWithModel(v, { apiKey: "test", fetchImpl }),
    /disclosed/,
  );
  assert.equal(input.you.word, p.word);
  assert.equal(input.words, undefined);
  assert.ok(input.players.every((p) => !("word" in p) && !("role" in p)));
});
test("clue reviewer has a separate reservation and chooses a safe alternative", async () => {
  const g = setup();
  action(g, g.host, "start");
  const p = g.players[1];
  g.order = [p.id];
  g.turn = 0;
  const v = view(g, p.id);
  let calls = 0,
    reviewCost;
  const d = await chooseWithModel(v, {
    apiKey: "test",
    reserveReview: () => ({ finish: (c) => (reviewCost = c) }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(
                ++calls === 1
                  ? { choice: 0, text: p.word, clues: ["contrast", "ritual"] }
                  : { index: 1 },
              ),
            },
          },
        ],
        usage: { cost: 0.001 },
      }),
    }),
  });
  assert.equal(d.choice.payload.text, "ritual");
  assert.equal(reviewCost, 0.001);
  assert.equal(calls, 2);
});
