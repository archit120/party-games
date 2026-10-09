import { test } from "node:test";
import assert from "node:assert/strict";
import { create, player, action, view, eligible, powers } from "../game.js";
function game(n = 5) {
  let g = create("ABCDEF", "P0");
  for (let i = 1; i < n; i++) g.players.push(player("P" + i));
  action(g, g.host, "start");
  g.president = 0;
  return g;
}
function elect(g) {
  const id = eligible(g)[0];
  action(g, g.players[g.president].id, "nominate", { target: id });
  for (const p of g.players.filter((p) => p.alive))
    action(g, p.id, "vote", { yes: true });
  return id;
}
test("role and deck distributions for every supported player count", () => {
  for (let n = 5; n <= 10; n++) {
    let g = game(n);
    assert.equal(g.players.filter((p) => p.role === "Hitler").length, 1);
    assert.equal(
      g.players.filter((p) => p.role === "Fascist").length,
      Math.floor((n - 3) / 2),
    );
    assert.equal(g.deck.filter((p) => p === "Liberal").length, 6);
    assert.equal(g.deck.filter((p) => p === "Fascist").length, 11);
  }
});
test("secret views never leak roles, tokens, deck, or uncast votes", () => {
  let g = game(7);
  g.players[0].role = "Liberal";
  let v = view(g, g.players[0].id);
  assert.equal(v.me.allies.length, 0);
  assert.ok(v.players.every((p) => !p.role && !p.token));
  assert.equal(v.deck, undefined);
  action(g, g.players[0].id, "nominate", { target: eligible(g)[0] });
  action(g, g.players[1].id, "vote", { yes: false });
  v = view(g, g.players[0].id);
  assert.deepEqual(v.voted, [g.players[1].id]);
  assert.equal(v.votes, undefined);
});
test("Hitler knows ally only in 5–6 player games", () => {
  for (let n = 5; n <= 10; n++) {
    let g = game(n),
      h = g.players.find((p) => p.role === "Hitler");
    assert.equal(view(g, h.id).me.allies.length, n <= 6 ? 1 : 0);
  }
});
test("strict majority: tie fails; three failures enact chaos and clear terms, without power", () => {
  let g = game(6);
  g.Fascist = 2;
  g.deck[0] = "Fascist";
  g.last = { president: g.players[4].id, chancellor: g.players[5].id };
  for (let i = 0; i < 3; i++) {
    action(g, g.players[g.president].id, "nominate", {
      target: eligible(g)[0],
    });
    for (let j = 0; j < 6; j++)
      action(g, g.players[j].id, "vote", { yes: j < 3 });
  }
  assert.equal(g.Fascist, 3);
  assert.equal(g.tracker, 0);
  assert.equal(g.last, null);
  assert.equal(g.phase, "nominate");
});
test("legislation passes only authorized hands and enacts remaining policy", () => {
  let g = game();
  g.deck = ["Liberal", "Fascist", "Liberal", ...g.deck.slice(3)];
  let ch = elect(g);
  assert.equal(view(g, g.players[0].id).hand.length, 3);
  assert.equal(view(g, ch).hand.length, 0);
  assert.throws(() => action(g, ch, "discard", { index: 0 }));
  action(g, g.players[0].id, "discard", { index: 1 });
  assert.deepEqual(view(g, ch).hand, ["Liberal", "Liberal"]);
  assert.equal(view(g, g.players[0].id).hand.length, 0);
  action(g, ch, "discard", { index: 0 });
  assert.equal(g.Liberal, 1);
  assert.equal(g.phase, "nominate");
});
test("five living players limit only last Chancellor", () => {
  let g = game(6);
  g.last = { president: g.players[1].id, chancellor: g.players[2].id };
  assert.ok(!eligible(g).includes(g.players[1].id));
  g.players[5].alive = false;
  assert.ok(eligible(g).includes(g.players[1].id));
  assert.ok(!eligible(g).includes(g.players[2].id));
});
test("Hitler election after third Fascist policy immediately wins", () => {
  let g = game();
  g.Fascist = 3;
  g.players.forEach((p) => (p.role = "Liberal"));
  g.players[1].role = "Hitler";
  elect(g);
  assert.equal(g.winner, "Fascists");
  assert.equal(g.phase, "finished");
});
test("investigation reveals party only and cannot repeat", () => {
  let g = game(9);
  g.phase = "power";
  g.power = "investigate";
  g.players[1].role = "Hitler";
  action(g, g.players[0].id, "power", { target: g.players[1].id });
  assert.match(g.players[0].notes[0], /Fascist party/);
  assert.ok(!g.players[0].notes[0].includes("Hitler"));
  g.phase = "power";
  g.power = "investigate";
  assert.throws(() =>
    action(g, g.players[1].id, "power", { target: g.players[1].id }),
  );
  g.president = 0;
  assert.throws(() =>
    action(g, g.players[0].id, "power", { target: g.players[1].id }),
  );
});
test("special election resumes after calling president even when special president is next", () => {
  let g = game(7);
  g.phase = "power";
  g.power = "special";
  action(g, g.players[0].id, "power", { target: g.players[1].id });
  assert.equal(g.president, 1);
  action(g, g.players[1].id, "nominate", { target: eligible(g)[0] });
  for (const p of g.players) action(g, p.id, "vote", { yes: false });
  assert.equal(g.president, 1);
  assert.equal(g.resume, null);
});
test("execution wins only for Hitler and dead players cannot act", () => {
  let g = game();
  g.phase = "power";
  g.power = "execute";
  g.players[1].role = "Liberal";
  action(g, g.players[0].id, "power", { target: g.players[1].id });
  assert.equal(g.players[1].alive, false);
  assert.equal(g.president, 2);
  assert.throws(() =>
    action(g, g.players[1].id, "nominate", { target: g.players[3].id }),
  );
  g.phase = "power";
  g.power = "execute";
  g.players[3].role = "Hitler";
  action(g, g.players[2].id, "power", { target: g.players[3].id });
  assert.equal(g.winner, "Liberals");
});
test("veto denial forces policy; acceptance advances existing tracker to chaos", () => {
  let g = game();
  g.Fascist = 5;
  g.players.forEach((p) => (p.role = "Liberal"));
  let ch = elect(g);
  action(g, g.players[0].id, "discard", { index: 0 });
  action(g, ch, "veto");
  action(g, g.players[0].id, "respond-veto", { yes: false });
  assert.throws(() => action(g, ch, "veto"));
  g.vetoDenied = false;
  g.tracker = 2;
  g.deck[0] = "Liberal";
  action(g, ch, "veto");
  action(g, g.players[0].id, "respond-veto", { yes: true });
  assert.equal(g.Liberal, 1);
  assert.equal(g.tracker, 0);
  assert.equal(g.last, null);
});
test("power tracks match starting counts", () => {
  assert.deepEqual(powers(5), [null, null, "peek", "execute", "execute", null]);
  assert.deepEqual(powers(7), [
    null,
    "investigate",
    "special",
    "execute",
    "execute",
    null,
  ]);
  assert.deepEqual(powers(10), [
    "investigate",
    "investigate",
    "special",
    "execute",
    "execute",
    null,
  ]);
});
test("hundreds of complete games preserve policy counts and always reach a winner", () => {
  for (let i = 0; i < 200; i++) {
    const g = game(5 + (i % 6));
    for (let step = 0; step < 600 && g.phase !== "finished"; step++) {
      const president = g.players[g.president].id;
      switch (g.phase) {
        case "nominate":
          action(g, president, "nominate", { target: eligible(g)[0] });
          break;
        case "vote":
          for (const p of g.players.filter((p) => p.alive))
            action(g, p.id, "vote", { yes: true });
          break;
        case "president-discard":
          action(g, president, "discard", { index: 0 });
          break;
        case "chancellor-discard":
          action(g, g.chancellor, "discard", { index: 0 });
          break;
        case "power":
          action(g, president, "power", {
            target: g.players.find(
              (p) =>
                p.alive && p.id !== president && !g.investigated.includes(p.id),
            )?.id,
          });
          break;
      }
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

test("policy peek privately reveals the top three in order without changing the deck", () => {
  const g = game(5);
  g.phase = "power";
  g.power = "peek";
  g.deck = ["Liberal", "Fascist", "Liberal", ...g.deck.slice(3)];
  const deck = [...g.deck];
  const president = g.players[g.president];
  const observer = g.players.find((p) => p.id !== president.id);
  action(g, president.id, "power");
  assert.deepEqual(g.deck, deck);
  assert.equal(g.phase, "nominate");
  assert.equal(
    view(g, president.id).me.notes.at(-1),
    "Policy peek: Liberal, Fascist, Liberal (top first).",
  );
  assert.deepEqual(view(g, observer.id).me.notes, []);
  assert.ok(!g.log.some((entry) => entry.includes("Liberal, Fascist")));
});

test("public starting role totals count Hitler separately and never change on execution", () => {
  for (let n = 5; n <= 10; n++) {
    const g = game(n),
      before = view(g, g.host).roleCounts;
    assert.equal(before.Hitler, 1);
    assert.equal(before.Fascist, Math.floor((n - 3) / 2));
    assert.equal(before.Liberal + before.Fascist + before.Hitler, n);
    g.players[1].alive = false;
    assert.deepEqual(view(g, g.host).roleCounts, before);
  }
});

test("only the host can restart a finished game; reset preserves seats and isolates new game secrets", () => {
  const g = game(7),
    host = g.players.find((p) => p.id === g.host),
    other = g.players.find((p) => p.id !== g.host);
  assert.throws(() => action(g, g.host, "restart"));
  g.phase = "finished";
  g.winner = "Liberals";
  g.reason = "Test";
  g.players[1].bot = true;
  host.alive = false;
  host.notes = ["old secret"];
  g.players[1].botMemory = [{ hand: ["Fascist"] }];
  g.players[1].pendingComment = "old";
  g.players[1].botPublicStatements = [{ text: "old claim" }];
  g.players[1].lastPolicyReaction = 1;
  g.lastPolicy = { number: 1 };
  g.chatMessages = [{ text: "old chat" }];
  g.botComments = [{ text: "old reaction" }];
  g.lastHumanChat = { text: "old trigger" };
  g.aiRequests = 120;
  g.aiComments = false;
  g.revision = 42;
  g.electionId = 9;
  const seats = g.players.map((p) => ({
    id: p.id,
    token: p.token,
    name: p.name,
    bot: !!p.bot,
  }));
  assert.throws(() => action(g, other.id, "restart"));
  action(g, g.host, "restart");
  assert.equal(g.phase, "lobby");
  assert.equal(g.gameId, 2);
  assert.equal(g.revision, 42);
  assert.equal(g.electionId, 9);
  assert.equal(g.aiRequests, 0);
  assert.equal(g.aiComments, false);
  assert.deepEqual(
    g.players.map((p) => ({
      id: p.id,
      token: p.token,
      name: p.name,
      bot: !!p.bot,
    })),
    seats,
  );
  assert.ok(
    g.players.every(
      (p) =>
        p.alive &&
        !p.role &&
        !p.botMemory &&
        !p.botPublicStatements &&
        !p.pendingComment &&
        p.notes.length === 0,
    ),
  );
  for (const key of [
    "winner",
    "reason",
    "deck",
    "lastPolicy",
    "chatMessages",
    "lastHumanChat",
    "botComments",
  ])
    assert.equal(g[key], undefined);
  assert.equal(view(g, host.id).me.role, undefined);
  assert.deepEqual(view(g, host.id).chatMessages, []);
  action(g, g.host, "start");
  assert.equal(g.phase, "nominate");
  assert.equal(g.deck.length, 17);
  assert.equal(g.Liberal, 0);
  assert.equal(g.Fascist, 0);
  assert.ok(g.players.every((p) => p.role && p.alive));
});

test("host can end any active phase, even when executed, then restart the room", () => {
  for (const phase of ["nominate", "vote", "president-discard", "chancellor-discard", "veto", "power"]) {
    const g = game();
    g.phase = phase;
    g.players[0].alive = false;
    g.hand = g.deck.splice(0, 2);
    const before = structuredClone(g);
    assert.throws(() => action(g, g.players[1].id, "end-game"), /Only the host/);
    assert.deepEqual(g, before);
    action(g, g.host, "end-game");
    assert.equal(g.phase, "finished");
    assert.equal(g.winner, null);
    assert.equal(g.hand.length, 0);
    assert.equal(g.deck.length + g.discard.length, 17);
    assert.ok(view(g, g.host).players.every(p => p.role));
    assert.throws(() => action(g, g.host, "end-game"), /no active game/);
    const tokens = g.players.map(p => p.token);
    action(g, g.host, "restart");
    assert.equal(g.phase, "lobby");
    assert.deepEqual(g.players.map(p => p.token), tokens);
    assert.throws(() => action(g, g.host, "end-game"), /no active game/);
  }
});
