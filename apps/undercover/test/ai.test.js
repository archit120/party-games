import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, action, view } from "../game.js";
import {
  decisionContext,
  chooseWithModel,
  basicDecision,
  createAIController,
  legalChoices,
} from "../ai.js";
function setup() {
  const g = create("ABCDEF", "Host");
  for (let i = 0; i < 4; i++) {
    const p = player("Bot " + i);
    p.bot = true;
    g.players.push(p);
  }
  g.settings.mrWhite = true;
  action(g, g.host, "start");
  return g;
}
const settle = () => new Promise((r) => setTimeout(r, 10));
test("model context only contains own word and public information, including Mr White", () => {
  const g = setup();
  for (const p of g.players) {
    const c = decisionContext(view(g, p.id));
    assert.equal(c.you.word, p.word);
    assert.equal(c.words, undefined);
    assert.equal(c.you.role, undefined);
    assert.ok(
      c.players.every(
        (x) =>
          !("word" in x) &&
          !("role" in x) &&
          !("token" in x) &&
          !("revealedRole" in x),
      ),
    );
    if (p.role === "mrWhite") assert.equal(c.you.word, null);
  }
});

const response = (parsed, cost = 0.001) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify(parsed) } }],
    usage: { cost },
  }),
});
test("shared provider request is bounded; clue output cannot directly disclose word", async () => {
  const g = setup(),
    p = g.players.find((p) => p.word);
  g.order = [p.id];
  g.turn = 0;
  const v = view(g, p.id);
  let request;
  const d = await chooseWithModel(v, {
    apiKey: "test",
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      return response({ choice: 0, text: "A familiar association." });
    },
  });
  assert.equal(d.choice.type, "clue");
  assert.equal(d.cost, 0.001);
  assert.equal(request.reasoning.effort, "low");
  assert.equal(request.max_tokens, 250);
  assert.equal(request.provider.max_price.completion, 0.6);
  await assert.rejects(
    () =>
      chooseWithModel(v, {
        apiKey: "test",
        fetchImpl: async () =>
          response({ choice: 0, text: "My word is " + p.word }),
      }),
    /disclosed/,
  );
});
test("AI returns only legal votes and rejects invalid indices", async () => {
  const g = setup();
  g.phase = "vote";
  g.voteId++;
  g.candidates = g.players.map((p) => p.id);
  g.votes = {};
  const p = g.players[1],
    v = view(g, p.id);
  const d = await chooseWithModel(v, {
    apiKey: "test",
    fetchImpl: async () => response({ choice: 0 }),
  });
  assert.notEqual(d.choice.payload.target, p.id);
  await assert.rejects(
    () =>
      chooseWithModel(v, {
        apiKey: "test",
        fetchImpl: async () => response({ choice: 999 }),
      }),
    /Illegal/,
  );
});
test("basic fallback is legal for clue, vote and Mr White guess", () => {
  const g = setup();
  for (const p of g.players) {
    g.phase = "clue";
    g.order = [p.id];
    g.turn = 0;
    assert.equal(basicDecision(view(g, p.id)).choice.type, "clue");
    g.phase = "vote";
    g.candidates = g.players.map((p) => p.id);
    g.votes = {};
    assert.notEqual(basicDecision(view(g, p.id)).choice.payload.target, p.id);
  }
  const p = g.players.find((p) => p.role === "mrWhite");
  p.alive = false;
  g.phase = "guess";
  g.guesser = p.id;
  assert.equal(basicDecision(view(g, p.id)).choice.type, "guess");
});
test("worker pauses without humans, discards stale replies, and reserves once", async () => {
  let g = setup(),
    t = 1000,
    resolve,
    requests = 0;
  const p = g.players[1];
  g.order = [p.id, ...g.players.filter((x) => x.id !== p.id).map((x) => x.id)];
  g.turn = 0;
  const ctl = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    reserveRequest: () => {
      requests++;
      return { finish() {} };
    },
    apiKey: "test",
    now: () => t,
    minDelay: 0,
    decide: () => new Promise((r) => (resolve = r)),
  });
  await ctl.step();
  await ctl.step();
  assert.equal(requests, 0);
  ctl.touch(g.code);
  await ctl.step();
  await ctl.step();
  await ctl.step();
  assert.equal(requests, 1);
  g.gameId = "new-game";
  resolve({
    choice: { type: "clue", payload: { text: "A distant memory." } },
    source: "model",
  });
  await settle();
  assert.equal(g.clues.length, 0);
  t += 61000;
  await ctl.step();
  assert.equal(requests, 1);
});
test("provider failure uses fallback, bot actions keep normal rules", async () => {
  let g = setup();
  const p = g.players[1];
  g.order = [p.id, ...g.players.filter((x) => x.id !== p.id).map((x) => x.id)];
  g.turn = 0;
  let finishes = 0;
  const ctl = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    reserveRequest: () => ({
      finish() {
        finishes++;
      },
    }),
    apiKey: "test",
    minDelay: 0,
    decide: async () => {
      throw Error("offline");
    },
  });
  ctl.touch(g.code);
  await ctl.step();
  await ctl.step();
  await settle();
  assert.equal(g.clues.length, 1);
  assert.equal(g.players[1].botSource, "basic");
  assert.equal(finishes, 1);
});
test("eliminated host may advance discussion without voting", () => {
  const g = setup();
  g.phase = "discussion";
  g.players[0].alive = false;
  action(g, g.host, "openVote");
  assert.equal(legalChoices(view(g, g.host)).length, 0);
  assert.throws(() => action(g, g.host, "vote", { target: g.players[1].id }));
});
