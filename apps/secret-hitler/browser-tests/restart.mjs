const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import { create, player, action, view } from "../game.js";
import { legalChoices, basicDecision, applyDecision } from "../ai.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const dir = await mkdtemp("/tmp/sh-restart-");
const g = create("ABCDEF", "Host");
for (let i = 1; i < 5; i++) g.players.push(player("Player " + i));
g.players.forEach((p) => (p.bot = true));
action(g, g.host, "start");
for (let i = 0; i < 1000 && g.phase !== "finished"; i++) {
  const p = g.players.find((p) => legalChoices(view(g, p.id)).length);
  applyDecision(g, p.id, basicDecision(view(g, p.id)));
  g.revision++;
}
assert.equal(g.phase, "finished");
g.players[0].bot = false;
g.players[1].bot = false;
g.players[0].alive = false;
g.players[1].notes = ["Old game intelligence"];
await writeFile(dir + "/rooms.json", JSON.stringify({ ABCDEF: g }));
const child = spawn(process.execPath, ["server.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: "0",
    OPENROUTER_API_KEY: "",
    AI_DAILY_BUDGET_USD: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const [buf] = await once(child.stdout, "data");
const base = "http://127.0.0.1:" + String(buf).match(/listening on (\d+)/)[1];
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const pages = [];
  const errors = [];
  for (const person of g.players.slice(0, 2)) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.evaluate(
      (s) => localStorage.setItem("assembly-session", JSON.stringify(s)),
      { code: g.code, token: person.token },
    );
    await p.goto(base + "/?room=ABCDEF");
    await p.locator(".action.finished").waitFor();
    pages.push(p);
  }
  const [host, guest] = pages;
  assert.equal(
    await guest
      .getByRole("button", { name: "Play again", exact: true })
      .count(),
    0,
  );
  const denied = await fetch(base + "/api/rooms/ABCDEF/action", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + g.players[1].token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "restart",
      revision: g.revision,
      payload: {},
    }),
  });
  assert.equal(denied.status, 400);
  await host.locator("#secret").click();
  await guest.locator("#view-intelligence").click();
  assert.equal(
    await guest.locator("#private-intelligence").evaluate((d) => d.open),
    true,
  );
  await host.getByRole("button", { name: "Play again", exact: true }).click();
  await host.locator(".action.lobby").waitFor();
  await guest.locator(".action.lobby").waitFor();
  assert.equal(
    await guest.locator("#private-intelligence").evaluate((d) => d.open),
    false,
  );
  const current = await (
    await fetch(base + "/api/rooms/ABCDEF", {
      headers: { Authorization: "Bearer " + g.players[0].token },
    })
  ).json();
  assert.equal(current.players.length, 5);
  assert.ok(current.players.every((p) => p.alive && !p.role));
  assert.equal(current.gameId, 2);
  assert.deepEqual(current.chatMessages, []);
  await host.getByRole("button", { name: "Deal roles & begin" }).click();
  await host.locator(".phase-ribbon").waitFor();
  await guest.locator(".phase-ribbon").waitFor();
  assert.equal(await host.locator(".secret.unsealed").count(), 0);
  assert.equal(await guest.locator(".secret.unsealed").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: finished host (even executed) can play again; guest denied; both keep seats; stale intelligence closes; lobby roster restored; new roles remain hidden; new game starts with same room.",
  );
} finally {
  await browser.close();
  const exited = once(child, "exit");
  child.kill();
  await exited;
  await rm(dir, { recursive: true, force: true });
}
