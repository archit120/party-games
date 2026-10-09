import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, action, view } from "../game.js";
const setup = (n = 5, mrWhite = false) => {
  const g = create("ABCDEF", "Alice");
  for (let i = 1; i < n; i++) g.players.push(player("P" + i));
  g.settings.mrWhite = mrWhite;
  action(g, g.host, "start");
  return g;
};
function ballot(g) {
  while (g.phase === "clue")
    action(g, g.order[g.turn], "clue", { text: "a clue" });
  action(g, g.players.find((p) => p.alive).id, "openVote");
}
function eliminate(g, target) {
  ballot(g);
  for (const p of g.players.filter((p) => p.alive))
    action(g, p.id, "vote", {
      target:
        p.id === target
          ? g.players.find((x) => x.alive && x.id !== target).id
          : target,
    });
}
test("role distributions, private words and server-only secrets for every player count", () => {
  for (let n = 3; n <= 12; n++) {
    const g = setup(n);
    assert.equal(g.players.filter((p) => p.role === "undercover").length, 1);
    assert.equal(g.players.filter((p) => p.role === "civilian").length, n - 1);
    for (const p of g.players) {
      const v = view(g, p.id);
      assert.equal(v.me.word, p.word);
      assert.equal(v.me.role, undefined);
      assert.equal(v.words, undefined);
      assert.ok(
        v.players.every(
          (p) => !("word" in p) && !("token" in p) && !("role" in p),
        ),
      );
      assert.equal(v.votes, undefined);
    }
  }
});
test("settings and starts require host, civilian majority, and valid values", () => {
  const g = create("ABCDEF", "A");
  g.players.push(player("B"), player("C"));
  assert.throws(() => action(g, g.players[1].id, "start"));
  action(g, g.host, "settings", { undercover: 1, mrWhite: true });
  assert.throws(() => action(g, g.host, "start"));
  assert.throws(() =>
    action(g, g.host, "settings", { undercover: 0, mrWhite: false }),
  );
});
test("clue turns are enforced, ballot choices stay private and civilians can win", () => {
  const g = setup(),
    bad = g.players.find((p) => p.role === "undercover");
  assert.throws(() =>
    action(g, g.players.find((p) => p.id !== g.order[0]).id, "clue", {
      text: "x",
    }),
  );
  ballot(g);
  const first = g.players.find((p) => p.id !== bad.id);
  action(g, first.id, "vote", { target: bad.id });
  assert.equal(view(g, bad.id).myVote, null);
  assert.equal(
    view(g, bad.id).players.find((p) => p.id === first.id).voted,
    true,
  );
  assert.throws(() => action(g, first.id, "vote", { target: bad.id }));
  for (const p of g.players.filter((p) => p.id !== first.id))
    action(g, p.id, "vote", { target: p.id === bad.id ? first.id : bad.id });
  assert.equal(g.winner, "civilians");
  assert.deepEqual(view(g, g.host).words, g.words);
});
test("tie runoff restricts candidates; second tie advances without elimination", () => {
  const g = setup(4);
  ballot(g);
  const ids = g.players.map((p) => p.id);
  for (let i = 0; i < 4; i++)
    action(g, ids[i], "vote", { target: ids[(i + 1) % 4] });
  assert.equal(g.phase, "vote");
  assert.equal(g.runoff, true);
  const voteId = g.voteId;
  for (let i = 0; i < 4; i++)
    action(g, ids[i], "vote", { target: ids[(i + 1) % 4] });
  assert.equal(g.phase, "clue");
  assert.equal(g.round, 2);
  assert.ok(g.players.every((p) => p.alive));
  assert.equal(g.voteId, voteId);
});
test("Mr White gets no word, guesses privately, and can win or lose", () => {
  for (const correct of [true, false]) {
    const g = setup(7, true),
      white = g.players.find((p) => p.role === "mrWhite");
    assert.equal(view(g, white.id).me.word, null);
    assert.equal(view(g, white.id).me.wordless, true);
    eliminate(g, white.id);
    assert.equal(g.phase, "guess");
    assert.throws(() =>
      action(g, g.players.find((p) => p.id !== white.id).id, "guess", {
        word: g.words[0],
      }),
    );
    action(g, white.id, "guess", {
      word: correct ? " " + g.words[0].toUpperCase() + " " : "incorrect",
    });
    assert.equal(g.phase, correct ? "finished" : "clue");
    if (correct) assert.equal(g.winner, "mrWhite");
    else assert.throws(() => action(g, white.id, "clue", { text: "dead" }));
  }
});
test("impostor parity wins and restart clears secrets while keeping seats", () => {
  const g = setup(3);
  eliminate(g, g.players.find((p) => p.role === "civilian").id);
  assert.equal(g.winner, "impostors");
  const tokens = g.players.map((p) => p.token);
  action(g, g.host, "restart");
  assert.equal(g.phase, "lobby");
  assert.equal(g.words, undefined);
  assert.ok(
    g.players.every((p) => p.word === undefined && p.role === undefined),
  );
  assert.deepEqual(
    g.players.map((p) => p.token),
    tokens,
  );
});
test("100 complete games with 3–12 players finish correctly", () => {
  for (let i = 0; i < 100; i++) {
    const g = setup(3 + (i % 10));
    while (g.phase !== "finished") {
      const target = g.players.find(
        (p) => p.alive && p.role === (i % 2 ? "undercover" : "civilian"),
      );
      eliminate(g, target.id);
    }
    assert.equal(g.winner, i % 2 ? "civilians" : "impostors");
  }
});
