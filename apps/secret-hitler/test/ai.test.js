import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, action, view, eligible } from "../game.js";
import {
  legalChoices,
  decisionContext,
  basicDecision,
  applyDecision,
  chooseWithModel,
  createAIController,
  flushComments,
  policyReactors,
} from "../ai.js";
function game(n = 5) {
  const g = create("ABCDEF", "Human");
  for (let i = 1; i < n; i++) {
    const p = player("Bot " + i);
    p.bot = true;
    g.players.push(p);
  }
  action(g, g.host, "start");
  g.president = 1;
  return g;
}
function elect(g) {
  action(g, g.players[g.president].id, "nominate", { target: eligible(g)[0] });
  for (const p of g.players) action(g, p.id, "vote", { yes: true });
}
test("model payload contains only seat knowledge and revealed ballots", () => {
  for (const n of [5, 7, 10]) {
    const g = game(n),
      h = g.players.find((p) => p.role === "Hitler");
    const ctx = decisionContext(view(g, h.id));
    assert.equal(ctx.you.knownAllies.length, n <= 6 ? 1 : 0);
    assert.ok(
      ctx.table.players.every((p) => !p.role && !p.token && !p.botMemory),
    );
    for (const p of g.players)
      assert.ok(!JSON.stringify(ctx).includes(p.token));
    assert.equal(ctx.deck, undefined);
  }
  const g = game();
  action(g, g.players[1].id, "nominate", { target: eligible(g)[0] });
  action(g, g.players[0].id, "vote", { yes: false });
  const ctx = decisionContext(view(g, g.players[1].id));
  assert.equal(ctx.table.lastRevealedVote, undefined);
  assert.equal(ctx.table.votes, undefined);
});
test("legal AI actions and fallback complete games for all player counts", () => {
  for (let i = 0; i < 90; i++) {
    const g = game(5 + (i % 6));
    g.players[0].bot = true;
    for (let step = 0; step < 700 && g.phase !== "finished"; step++) {
      const p = g.players.find((p) => legalChoices(view(g, p.id)).length);
      assert.ok(p, `stalled in ${g.phase}`);
      applyDecision(g, p.id, basicDecision(view(g, p.id)));
      assert.equal(
        g.deck.length +
          g.discard.length +
          g.hand.length +
          g.Liberal +
          g.Fascist,
        17,
      );
    }
    assert.equal(g.phase, "finished");
  }
});
test("discard means throw away opposing policy; private speech stays private", () => {
  const g = game();
  g.players[1].role = "Liberal";
  elect(g);
  g.hand = ["Fascist", "Liberal", "Liberal"];
  const p = g.players[1],
    d = basicDecision(view(g, p.id));
  assert.equal(d.choice.payload.index, 0);
  applyDecision(g, p.id, { ...d, comment: "secret hand" });
  assert.deepEqual(g.hand, ["Liberal", "Liberal"]);
  assert.equal(p.pendingComment, undefined);
  assert.equal(view(g, g.players[0].id).players[1].botMemory, undefined);
  g.phase = "nominate";
  p.pendingComment = "alive";
  g.players[2].pendingComment = "dead";
  g.players[2].alive = false;
  flushComments(g);
  assert.deepEqual(
    g.botComments.map((c) => c.text),
    ["alive"],
  );
});
test("veto and executive powers offer only eligible choices", () => {
  const g = game();
  elect(g);
  action(g, g.players[1].id, "discard", { index: 0 });
  g.Fascist = 5;
  assert.ok(legalChoices(view(g, g.chancellor)).some((c) => c.type === "veto"));
  action(g, g.chancellor, "veto");
  assert.equal(legalChoices(view(g, g.players[1].id)).length, 2);
  action(g, g.players[1].id, "respond-veto", { yes: false });
  assert.ok(
    !legalChoices(view(g, g.chancellor)).some((c) => c.type === "veto"),
  );
  g.phase = "power";
  g.power = "investigate";
  g.investigated = [g.players[2].id];
  g.players[3].alive = false;
  assert.deepEqual(
    legalChoices(view(g, g.players[1].id)).map((c) => c.payload.target),
    [g.players[0].id, g.players[4].id],
  );
  g.power = "peek";
  assert.deepEqual(legalChoices(view(g, g.players[1].id)), [
    { type: "power", payload: {} },
  ]);
});
test("provider replies must be valid legal choices; uses low GLM reasoning", async () => {
  const g = game(),
    v = view(g, g.players[1].id);
  let body;
  const fetchImpl = async (_, options) => {
    body = JSON.parse(options.body);
    new Headers(options.headers);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"choice":0,"comment":"Hello"}' } }],
        usage: { cost: 0.001 },
      }),
    };
  };
  const d = await chooseWithModel(v, { apiKey: "test", fetchImpl });
  assert.deepEqual(d.choice, legalChoices(v)[0]);
  assert.equal(d.cost, 0.001);
  assert.equal(body.reasoning.effort, "low");
  for (const content of [
    "<html>oops",
    '{"choice":999}',
    '{"choice":-1}',
    '{"choice":"0"}',
  ])
    await assert.rejects(
      chooseWithModel(v, {
        apiKey: "test",
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ choices: [{ message: { content } }] }),
        }),
      }),
    );
});
test("async worker avoids duplicates, ignores stale election, keeps concurrent human ballots", async () => {
  let g = game(),
    calls = 0,
    resolve,
    now = 0;
  action(g, g.players[1].id, "nominate", { target: eligible(g)[0] });
  const controller = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    reserveRequest: () => ({ finish() {} }),
    apiKey: "test",
    minDelay: 0,
    now: () => now,
    decide: (v) => {
      calls++;
      return new Promise(
        (r) =>
          (resolve = () =>
            r({ choice: legalChoices(v)[0], source: "model", comment: "" })),
      );
    },
  });
  controller.touch(g.code);
  await controller.step();
  await controller.step();
  await controller.step();
  assert.equal(calls, 1);
  action(g, g.players[0].id, "vote", { yes: true });
  resolve();
  await new Promise(setImmediate);
  assert.equal(Object.keys(g.votes).length, 2);
  await controller.step();
  await controller.step();
  assert.equal(calls, 2);
  const prior = g.electionId;
  g.electionId++;
  resolve();
  await new Promise(setImmediate);
  assert.equal(Object.keys(g.votes).length, 2);
  g.electionId = prior;
  now = 61000;
  await controller.step();
  await controller.step();
  assert.equal(calls, 2);
});
test("API failures and denied budget fall back without stalling", async () => {
  for (const allow of [true, false]) {
    let g = game();
    let calls = 0;
    const c = createAIController({
      getRooms: () => ({ [g.code]: g }),
      commit: (x) => (g = x),
      apiKey: "test",
      minDelay: 0,
      reserveRequest: () => (allow ? { finish() {} } : null),
      decide: async () => {
        calls++;
        throw Error("429");
      },
    });
    c.touch(g.code);
    await c.step();
    await c.step();
    await new Promise(setImmediate);
    assert.equal(g.phase, "vote");
    assert.equal(g.players[1].botSource, "basic");
    assert.equal(calls, allow ? 1 : 0);
  }
});

function revealPolicy() {
  const g = game();
  action(g, g.players[1].id, "nominate", { target: g.players[2].id });
  for (const p of g.players) action(g, p.id, "vote", { yes: true });
  applyDecision(g, g.players[1].id, basicDecision(view(g, g.players[1].id)));
  applyDecision(g, g.players[2].id, basicDecision(view(g, g.players[2].id)));
  return g;
}
test("policy event preserves actual government; reactions use private seat memory only", async () => {
  const g = revealPolicy();
  assert.equal(g.lastPolicy.number, 1);
  assert.equal(g.lastPolicy.president, g.players[1].id);
  assert.equal(g.lastPolicy.chancellor, g.players[2].id);
  assert.equal(g.lastPolicy.chaos, false);
  assert.equal(g.lastPolicy.policy, g.Liberal ? "Liberal" : "Fascist");
  assert.deepEqual(
    policyReactors(g).map((p) => p.id),
    [g.players[1].id, g.players[2].id],
  );
  let context;
  const d = await chooseWithModel(view(g, g.players[1].id), {
    apiKey: "test",
    task: "policy-reaction",
    memory: g.players[1].botMemory,
    fetchImpl: async (_, options) => {
      context = JSON.parse(JSON.parse(options.body).messages[1].content);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '{"choice":0,"comment":"I do not trust that government."}',
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(d.choice, null);
  assert.equal(context.task, "policy-reaction");
  assert.equal(context.you.observedHands.length, 1);
  assert.equal(context.you.observedHands[0].hand.length, 3);
  assert.ok(
    context.table.players.every((p) => !p.role && !p.token && !p.botMemory),
  );
  assert.deepEqual(context.privateHand, []);
  g.phase = "president-discard";
  await assert.rejects(
    chooseWithModel(view(g, g.players[1].id), { task: "policy-reaction" }),
  );
  g.lastPolicy.chaos = true;
  g.lastPolicy.president = null;
  g.lastPolicy.chancellor = null;
  assert.equal(policyReactors(g).length, 1);
  g.aiComments = false;
  assert.deepEqual(policyReactors(g), []);
});
test("reaction worker comments once, queues during voting and does not mutate ballots or phase", async () => {
  let g = revealPolicy(),
    calls = 0,
    resolve;
  const c = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    react: async () => {
      calls++;
      return new Promise(
        (r) =>
          (resolve = () =>
            r({ comment: "That policy makes me suspicious.", cost: 0.001 })),
      );
    },
  });
  c.touch(g.code);
  await c.step();
  await c.step();
  assert.equal(calls, 1);
  const president = g.players[g.president].id;
  action(g, president, "nominate", { target: eligible(g)[0] });
  const rev = g.revision;
  resolve();
  await new Promise(setImmediate);
  assert.equal(g.phase, "vote");
  assert.deepEqual(g.votes, {});
  assert.equal(g.revision, rev);
  assert.ok(!g.botComments.some((c) => c.policyNumber));
  g.phase = "nominate";
  flushComments(g);
  assert.equal(g.botComments.filter((c) => c.policyNumber === 1).length, 1);
  assert.equal(policyReactors(g).length, 1);
  await c.step();
  resolve();
  await new Promise(setImmediate);
  assert.equal(policyReactors(g).length, 0);
  assert.equal(g.botComments.filter((c) => c.policyNumber === 1).length, 2);
  flushComments(g);
  assert.equal(g.botComments.filter((c) => c.policyNumber === 1).length, 2);
});
test("stale reactions and dead speakers stay silent; failures do not retry forever", async () => {
  for (const change of ["new-policy", "dead", "off", "error", "budget"]) {
    let g = revealPolicy(),
      resolve,
      calls = 0;
    const c = createAIController({
      getRooms: () => ({ [g.code]: g }),
      commit: (x) => (g = x),
      apiKey: "test",
      reserveRequest: () => (change === "budget" ? null : { finish() {} }),
      react: async () => {
        calls++;
        if (change === "error") throw Error("429");
        return new Promise((r) => (resolve = () => r({ comment: "Reaction" })));
      },
    });
    c.touch(g.code);
    await c.step();
    if (change === "new-policy") g.lastPolicy.number++;
    if (change === "dead") g.players[1].alive = false;
    if (change === "off") g.aiComments = false;
    resolve?.();
    await new Promise(setImmediate);
    assert.ok(!g.botComments.some((c) => c.policyNumber));
    if (["error", "budget"].includes(change))
      assert.equal(g.players[1].lastPolicyReaction, 1);
    assert.equal(calls, change === "budget" ? 0 : 1);
  }
});

test("public comments reject reported sabotage confessions and keep legal moves", async () => {
  const { reviewPublicComment, obviousPublicSlip } = await import("../ai.js");
  const g = revealPolicy(),
    v = view(g, g.players[1].id);
  const bad = [
    "Altaf passed me Liberal+Fascist and I had to pick one — I chose Fascist. I know that looks bad, but I'd rather own it than hide.",
    "Altaf's earlier government gave us a Fascist policy — that's a point in his favor.",
  ];
  for (const text of bad) {
    assert.equal(obviousPublicSlip(text), true);
    assert.equal(
      await reviewPublicComment(v, text, {
        reserveReview: () => {
          throw Error("Should reject without spending");
        },
      }),
      "",
    );
  }
  let reviewContext, finishedCost;
  const reviewed = await reviewPublicComment(v, "I was forced to enact it.", {
    apiKey: "test",
    ownStatements: [
      { text: "My hand was two Fascist cards.", policyNumber: 1 },
    ],
    reserveReview: () => ({ finish: (c) => (finishedCost = c) }),
    fetchImpl: async (_, options) => {
      reviewContext = JSON.parse(JSON.parse(options.body).messages[1].content);
      return {
        ok: true,
        json: async () => ({
          usage: { cost: 0.001 },
          choices: [{ message: { content: '{"publish":true}' } }],
        }),
      };
    },
  });
  assert.equal(reviewed, "I was forced to enact it.");
  assert.equal(finishedCost, 0.001);
  assert.equal(reviewContext.secretRole, undefined);
  assert.equal(reviewContext.hand, undefined);
  assert.equal(reviewContext.previousPublicStatements[0].policyNumber, 1);
  assert.ok(reviewContext.players.every((p) => !p.role && !p.token));
  for (const response of [
    "not-json",
    '{"publish":false}',
    '{"publish":"true"}',
  ]) {
    assert.equal(
      await reviewPublicComment(v, "A plausible draft.", {
        reserveReview: () => ({ finish() {} }),
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ choices: [{ message: { content: response } }] }),
        }),
      }),
      "",
    );
  }
  const nom = game(),
    nv = view(nom, nom.players[1].id);
  const d = await chooseWithModel(nv, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ choice: 0, comment: bad[0] }),
            },
          },
        ],
      }),
    }),
  });
  assert.deepEqual(d.choice, legalChoices(nv)[0]);
  assert.equal(d.comment, "");
});
test("private observations explain discard semantics and public claims retain their round", async () => {
  const { publicStatements, trimPublicComment } = await import("../ai.js");
  const g = revealPolicy(),
    p = g.players[1];
  p.pendingPolicyComment = {
    text: "My claim for policy one.",
    policyNumber: 1,
    policy: g.lastPolicy.policy,
  };
  flushComments(g);
  assert.equal(publicStatements(g, p)[0].policyNumber, 1);
  assert.equal(publicStatements(g, p)[0].electionId, g.lastPolicy.electionId);
  const ctx = decisionContext(
    view(g, p.id),
    p.botMemory,
    g.botComments,
    publicStatements(g, p),
  );
  assert.equal(ctx.you.observedHands[0].passedToChancellor.length, 2);
  assert.equal(
    ctx.you.observedHands[0].discarded,
    p.botMemory[0].hand[p.botMemory[0].action.payload.index],
  );
  assert.equal(ctx.you.previousPublicStatements[0].policyNumber, 1);
  assert.equal(ctx.table.tableComments[0].policyNumber, 1);
  assert.equal(
    view(g, g.players[0].id).players[1].botPublicStatements,
    undefined,
  );
  const first = "This is a complete sentence about a policy.";
  assert.equal(
    trimPublicComment(first + " Another " + "word ".repeat(100)),
    first,
  );
  assert.ok(trimPublicComment("word ".repeat(100)).length <= 220);
});

test("an in-flight comment from a finished game cannot enter the restarted lobby", async () => {
  let g = revealPolicy(),
    resolve;
  g.phase = "finished";
  const c = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    react: async () =>
      new Promise((r) => (resolve = () => r({ comment: "Old game remark" }))),
  });
  c.touch(g.code);
  await c.step();
  action(g, g.host, "restart");
  const revision = g.revision;
  resolve();
  await new Promise(setImmediate);
  assert.equal(g.phase, "lobby");
  assert.equal(g.revision, revision);
  assert.equal(g.botComments, undefined);
  assert.equal(g.players[1].lastPolicyReaction, undefined);
});
