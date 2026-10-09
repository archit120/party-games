import { readJSON, writeJSON } from "../core/storage.js";
// Preserve Secret Hitler's ledger and room counters across the extraction.
export function createBudget({
  file,
  getRoom,
  saveRooms,
  dailyBudget = 0.5,
  now = Date.now,
}) {
  let ledger = readJSON(file);
  const limit = Number.isFinite(Number(dailyBudget))
    ? Math.max(0, Number(dailyBudget))
    : 0;
  return function reserve(code) {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (ledger.day !== day) ledger = { day, spent: 0, requests: 0 };
    const room = getRoom(code),
      amount = 0.01;
    if (
      !room ||
      (room.aiRequests ?? 0) >= 120 ||
      ledger.requests >= 1000 ||
      ledger.spent + amount > limit
    )
      return null;
    room.aiRequests = (room.aiRequests ?? 0) + 1;
    ledger.spent += amount;
    ledger.requests++;
    saveRooms();
    writeJSON(file, ledger);
    let finished = false;
    return {
      finish(cost) {
        if (finished || ledger.day !== day) return;
        finished = true;
        if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0)
          ledger.spent = Math.max(0, ledger.spent - amount + cost);
        writeJSON(file, ledger);
      },
    };
  };
}
