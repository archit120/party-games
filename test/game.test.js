import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, move, view, roles, living } from "../game.js";
function setup(n = 3) {
  const g = create("ABCDEF", "A");
  for (let i = 1; i < n; i++) g.players.push(player("P" + i));
  move(g, g.host, "start");
  return g;
}
function doMove(g, i, t, d) {
  move(g, g.players[i].id, t, d);
}
function passAll(g) {
  while (["claim", "block", "blockClaim"].includes(g.phase)) {
    const p = g.players.find((p) => view(g, p.id).canRespond);
    assert.ok(p);
    move(g, p.id, "pass");
  }
}
function inventory(g) {
  return [
    ...g.deck,
    ...g.players.flatMap((p) => p.cards.map((c) => c.role)),
    ...(g.exchange ? g.exchange.cards.slice(-2) : []),
  ].sort();
}
test("decks, initial coins and private views for 2–6 players", () => {
  for (let n = 2; n <= 6; n++) {
    const g = setup(n);
    assert.deepEqual(inventory(g), roles.flatMap((r) => [r, r, r]).sort());
    assert.equal(g.players[0].coins, n === 2 ? 1 : 2);
    const v = view(g, g.host);
    assert.equal(JSON.stringify(v).includes("token"), false);
    assert.equal(v.players[1].cards[0].role, null);
    assert.equal(v.players[0].cards[0].role, g.players[0].cards[0].role);
  }
});
test("income, tax, aid, steal and mandatory coup", () => {
  const g = setup();
  doMove(g, 0, "tax");
  passAll(g);
  assert.equal(g.players[0].coins, 5);
  doMove(g, 1, "aid");
  passAll(g);
  assert.equal(g.players[1].coins, 4);
  doMove(g, 2, "steal", { target: g.players[0].id });
  passAll(g);
  assert.equal(g.players[2].coins, 4);
  assert.equal(g.players[0].coins, 3);
  g.players[0].coins = 10;
  assert.throws(() => doMove(g, 0, "income"));
  doMove(g, 0, "coup", { target: g.players[1].id });
  assert.equal(g.phase, "loss");
  doMove(g, 1, "reveal", { index: 0 });
  assert.equal(g.players[0].coins, 3);
  assert.equal(g.turn, 1);
});
test("false action claim cancels action, costs remain paid", () => {
  const g = setup();
  g.players[0].cards.forEach((c) => (c.role = "Duke"));
  g.players[0].coins = 3;
  doMove(g, 0, "assassinate", { target: g.players[1].id });
  doMove(g, 1, "challenge");
  doMove(g, 0, "reveal", { index: 0 });
  assert.equal(g.players[0].coins, 0);
  assert.equal(g.players[1].cards.filter((c) => !c.revealed).length, 2);
  assert.equal(g.turn, 1);
});
test("true claim replaces proven card and challenger loses", () => {
  const g = setup();
  const role = g.players[0].cards[0].role;
  const type = {
    Duke: "tax",
    Assassin: "assassinate",
    Captain: "steal",
    Ambassador: "exchange",
    Contessa: null,
  }[role];
  if (!type) {
    g.players[0].cards[0].role = "Duke";
  }
  g.players[0].coins = 3;
  const before = inventory(g);
  doMove(g, 0, type || "tax", { target: g.players[1].id });
  doMove(g, 1, "challenge");
  assert.equal(g.loss.id, g.players[1].id);
  doMove(g, 1, "reveal", { index: 0 });
  assert.deepEqual(inventory(g), before);
});
test("false assassination block loses two influences", () => {
  const g = setup();
  g.players[0].coins = 3;
  g.players[1].cards = [
    { role: "Duke", revealed: false },
    { role: "Captain", revealed: false },
  ];
  doMove(g, 0, "assassinate", { target: g.players[1].id });
  doMove(g, 1, "pass");
  doMove(g, 2, "pass");
  doMove(g, 1, "block", { role: "Contessa" });
  doMove(g, 0, "challenge");
  doMove(g, 1, "reveal", { index: 0 });
  assert.equal(g.phase, "loss");
  doMove(g, 1, "reveal", { index: 1 });
  assert.equal(living(g.players[1]), false);
  assert.equal(g.turn, 2);
});
test("true block stops action after challenge", () => {
  const g = setup();
  g.players[1].cards[0].role = "Duke";
  doMove(g, 0, "aid");
  doMove(g, 1, "block", { role: "Duke" });
  doMove(g, 0, "challenge");
  doMove(g, 0, "reveal", { index: 0 });
  assert.equal(g.players[0].coins, 2);
  assert.equal(g.turn, 1);
});
test("exchange preserves deck and keeps private choices", () => {
  const g = setup(),
    before = inventory(g);
  doMove(g, 0, "exchange");
  passAll(g);
  assert.equal(view(g, g.players[1].id).exchange, undefined);
  assert.equal(g.exchange.cards.length, 4);
  assert.throws(() => doMove(g, 0, "keep", { indices: [0, 0] }));
  doMove(g, 0, "keep", { indices: [2, 3] });
  assert.deepEqual(inventory(g), before);
  assert.equal(g.phase, "turn");
});
test("only target can block assassination; accepted block ends turn", () => {
  const g = setup();
  g.players[0].coins = 3;
  doMove(g, 0, "assassinate", { target: g.players[1].id });
  doMove(g, 1, "pass");
  doMove(g, 2, "pass");
  assert.throws(() => doMove(g, 2, "block", { role: "Contessa" }));
  doMove(g, 1, "block", { role: "Contessa" });
  passAll(g);
  assert.equal(g.turn, 1);
  assert.equal(g.players[1].cards.filter((c) => !c.revealed).length, 2);
});
test("200 complete games maintain card totals and terminate with one survivor", () => {
  for (let run = 0; run < 200; run++) {
    const g = setup(2 + (run % 5)),
      expected = inventory(g);
    for (let step = 0; g.phase !== "finished" && step < 1500; step++) {
      if (g.phase === "turn") {
        const p = g.players[g.turn],
          target = g.players.find((x) => x.id !== p.id && living(x)).id;
        move(
          g,
          p.id,
          p.coins >= 7 ? "coup" : step % 5 === 0 ? "exchange" : "tax",
          { target },
        );
      } else if (g.phase === "loss") {
        const p = g.players.find((p) => p.id === g.loss.id);
        move(g, p.id, "reveal", {
          index: p.cards.findIndex((c) => !c.revealed),
        });
      } else if (g.phase === "exchange")
        move(g, g.exchange.id, "keep", {
          indices: Array.from({ length: g.exchange.count }, (_, i) => i),
        });
      else {
        const p = g.players.find((p) => view(g, p.id).canRespond);
        move(
          g,
          p.id,
          step % 4 === 0 && g.phase !== "block" ? "challenge" : "pass",
        );
      }
      assert.deepEqual(inventory(g), expected);
    }
    assert.equal(g.phase, "finished");
    assert.equal(g.players.filter(living).length, 1);
  }
});
