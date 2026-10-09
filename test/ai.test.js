import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createBudget } from "../packages/ai/budget.js";
import { readJSON } from "../packages/core/storage.js";
import { createActivity } from "../packages/ai/activity.js";
test("shared AI budget persists reservations, rejects overspend, reconciles once, resets daily", async () => {
  const dir = await mkdtemp(tmpdir() + "/ai-budget-");
  try {
    let now = Date.UTC(2026, 0, 1),
      g = { aiRequests: 0 };
    const file = dir + "/budget.json";
    const options = {
      file,
      getRoom: () => g,
      saveRooms() {},
      dailyBudget: 0.02,
      now: () => now,
    };
    let reserve = createBudget(options);
    const a = reserve("A"),
      b = reserve("A");
    assert.ok(a && b);
    assert.equal(reserve("A"), null);
    a.finish(0.002);
    a.finish(0);
    assert.equal(readJSON(file).spent, 0.012);
    b.finish(null);
    reserve = createBudget(options);
    assert.equal(reserve("A"), null);
    now += 86400000;
    assert.ok(reserve("A"));
    g.aiRequests = 120;
    assert.equal(reserve("A"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("shared worker activity expires and concurrency is bounded", () => {
  let now = 0;
  const a = createActivity({ now: () => now, maxConcurrent: 1 });
  assert.equal(a.eligible("A"), false);
  a.touch("A");
  assert.equal(a.eligible("A"), true);
  a.workers.set("A", "bot");
  a.touch("B");
  assert.equal(a.eligible("B"), false);
  a.workers.clear();
  now = 60001;
  assert.equal(a.eligible("A"), false);
  now = 3600001;
  a.prune();
  assert.equal(a.active.size, 0);
});
