import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, view } from "../game.js";
import { addChat, chatResponder, tableMessages } from "../chat.js";
import { createAIController, chooseWithModel, flushComments } from "../ai.js";
function fixture() {
  const g = create("ABCDEF", "Human");
  for (const name of ["Ada · AI", "Basil · AI"]) {
    const p = player(name);
    p.bot = true;
    g.players.push(p);
  }
  return g;
}
test("chat validates membership, phase, death, length and rate limits; view excludes private metadata", () => {
  const g = fixture();
  const t = Date.now();
  const m = addChat(g, g.host, "Hello Ada", t);
  assert.equal(m.seq, 1);
  assert.equal(chatResponder(g, t + 2000).name, "Ada · AI");
  assert.throws(() => addChat(g, "unknown", "Hello", t));
  assert.throws(() => addChat(g, g.players[1].id, "Hello", t));
  assert.throws(() => addChat(g, g.host, "repeat", t + 100));
  assert.throws(() => addChat(g, g.host, "x".repeat(401), t + 3000));
  for (const phase of ["president-discard", "chancellor-discard", "veto"]) {
    g.phase = phase;
    assert.throws(() => addChat(g, g.host, "secret hand", t + 3000));
  }
  g.phase = "nominate";
  g.players[0].alive = false;
  assert.throws(() => addChat(g, g.host, "dead clue", t + 3000));
  g.phase = "finished";
  addChat(g, g.host, "Good game", t + 3000);
  assert.equal(g.chatMessages.length, 2);
  const v = view(g, g.host);
  assert.equal(v.players[0].chatTimes, undefined);
  assert.equal(v.lastHumanChat, undefined);
  assert.equal(v.chatMessages[0].text, "Hello Ada");
  g.aiComments = false;
  assert.equal(chatResponder(g, t + 5000), null);
});
test("one AI replies to a human message, without taking a turn or triggering another reply", async () => {
  let g = fixture(),
    time = Date.now(),
    calls = 0;
  addChat(g, g.host, "Ada, how do Liberals win?", time);
  time += 2000;
  const c = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    now: () => time,
    react: async (v, opts) => {
      calls++;
      assert.equal(opts.task, "chat-response");
      assert.equal(opts.replyTo.text, "Ada, how do Liberals win?");
      assert.equal(v.me.id, g.players[1].id);
      return {
        comment: "Enact five Liberal policies or execute Hitler.",
        cost: 0.001,
      };
    },
  });
  c.touch(g.code);
  await c.step();
  await new Promise(setImmediate);
  await c.step();
  assert.equal(calls, 1);
  assert.equal(g.phase, "lobby");
  assert.equal(g.chatMessages.length, 2);
  assert.equal(g.chatMessages[1].bot, true);
  assert.equal(g.lastChatHandledSeq, 1);
  assert.equal(tableMessages(g).length, 2);
});
test("chat replies received during legislation queue, and dead bots cannot publish", async () => {
  let g = fixture(),
    time = Date.now(),
    resolve;
  addChat(g, g.host, "Ada, thoughts?", time);
  time += 2000;
  const c = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    now: () => time,
    react: async () =>
      new Promise(
        (r) => (resolve = () => r({ comment: "Let us compare claims." })),
      ),
  });
  c.touch(g.code);
  await c.step();
  g.phase = "veto";
  resolve();
  await new Promise(setImmediate);
  assert.equal(g.chatMessages.length, 1);
  g.players[1].alive = false;
  g.phase = "nominate";
  flushComments(g);
  assert.equal(g.chatMessages.length, 1);
});
test("chat model has one comment choice, includes untrusted message, no hidden table roles", async () => {
  const g = fixture();
  let context;
  const r = await chooseWithModel(view(g, g.players[1].id), {
    task: "chat-response",
    replyTo: { name: "Human", text: "What do you think?" },
    fetchImpl: async (_, options) => {
      context = JSON.parse(JSON.parse(options.body).messages[1].content);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '{"choice":0,"comment":"Let us see the first policy."}',
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(r.choice, null);
  assert.equal(context.replyTo.text, "What do you think?");
  assert.deepEqual(context.choices, [{ index: 0, type: "comment" }]);
  assert.ok(context.table.players.every((p) => !p.role && !p.token));
});

test("two relevant bots can respond once each, with shared context and no AI reply loop", async () => {
  const { chatReplyTargets } = await import("../chat.js");
  let g = fixture(),
    time = Date.now(),
    calls = [];
  const message = addChat(g, g.host, "Ada and Basil, what do you think?", time);
  time += 2000;
  assert.equal(chatReplyTargets(g, message).length, 2);
  const c = createAIController({
    getRooms: () => ({ [g.code]: g }),
    commit: (x) => (g = x),
    apiKey: "test",
    reserveRequest: () => ({ finish() {} }),
    now: () => time,
    react: async (v, opts) => {
      calls.push(v.me.id);
      if (calls.length === 2)
        assert.ok(opts.comments.some((m) => m.text === "First view"));
      return {
        comment: calls.length === 1 ? "First view" : "Another relevant view",
      };
    },
  });
  c.touch(g.code);
  await c.step();
  await new Promise(setImmediate);
  assert.equal(g.lastChatHandledSeq, undefined);
  await c.step();
  await new Promise(setImmediate);
  await c.step();
  assert.equal(new Set(calls).size, 2);
  assert.equal(calls.length, 2);
  assert.equal(g.chatMessages.filter((m) => m.bot).length, 2);
  assert.equal(g.lastChatHandledSeq, message.seq);
});
test("policy questions select involved AI seats; generic chat picks one; dead bots and chatter do not expand the plan", async () => {
  const { chatReplyTargets } = await import("../chat.js");
  const g = fixture(),
    time = Date.now();
  g.lastPolicy = {
    number: 1,
    policy: "Fascist",
    president: g.players[1].id,
    chancellor: g.players[2].id,
  };
  const msg = addChat(g, g.host, "What cards did that government have?", time);
  assert.equal(chatReplyTargets(g, msg).length, 2);
  g.lastPolicy = { number: 2, chaos: true };
  assert.equal(chatReplyTargets(g, msg).length, 2);
  const generic = addChat(g, g.host, "Hello there", time + 3000);
  assert.equal(chatReplyTargets(g, generic).length, 1);
  g.players[2].alive = false;
  const both = addChat(g, g.host, "Ada and Basil, thoughts?", time + 6000);
  assert.deepEqual(chatReplyTargets(g, both), [g.players[1].id]);
});
