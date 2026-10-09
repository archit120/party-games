// Shared per-room activity/concurrency gate from Secret Hitler's worker.
export function createActivity({ now = Date.now, maxConcurrent = 2 } = {}) {
  const active = new Map(),
    workers = new Map(),
    due = new Map();
  return {
    active,
    workers,
    due,
    touch: (code) => active.set(code, now()),
    eligible: (code) =>
      workers.size < maxConcurrent &&
      active.has(code) &&
      now() - active.get(code) <= 60000 &&
      !workers.has(code),
    prune() {
      for (const [code, time] of active)
        if (now() - time > 3600000) {
          active.delete(code);
          due.delete(code);
        }
    },
  };
}
