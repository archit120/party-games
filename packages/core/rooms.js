import { randomInt, randomBytes, createHash } from "node:crypto";
export function roomCode(exists) {
  let code;
  do {
    code = Array.from(
      { length: 6 },
      () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[randomInt(24)],
    ).join("");
  } while (exists(code));
  return code;
}
export function authenticate(g, authorization) {
  const token = authorization?.replace(/^Bearer /, "");
  return token
    ? g?.players.find((p) => p.token === token && !p.bot)
    : undefined;
}
export function issueRecovery(player, now = Date.now()) {
  const key = randomBytes(32).toString("hex");
  player.recovery = {
    hash: createHash("sha256").update(key).digest("hex"),
    expires: now + 15 * 60000,
  };
  return key;
}
export function recoverSeat(g, key, now = Date.now()) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) return;
  const hash = createHash("sha256").update(key).digest("hex");
  return g?.players.find(
    (p) => !p.bot && p.recovery?.hash === hash && p.recovery.expires > now,
  );
}
// Secret Hitler's retry-safe joining contract, shared with new games.
export function joinSeat(g, requested, joinKey, maxPlayers) {
  const key =
    typeof joinKey === "string" && /^[a-f0-9]{64}$/.test(joinKey)
      ? joinKey
      : null;
  const existing = key
    ? g.players.find((p) => p.joinKey === key && !p.bot)
    : null;
  if (existing) {
    if (existing.name.toLowerCase() !== requested.name.toLowerCase())
      throw Error("This join attempt belongs to a different name.");
    return { player: existing, added: false };
  }
  if (g.phase !== "lobby")
    throw Error(
      "This game has already started. Ask the host for your private Recover seat link.",
    );
  if (
    g.players.some((p) => p.name.toLowerCase() === requested.name.toLowerCase())
  )
    throw Error(
      "That name already has a seat. Ask the host to send you a private Recover seat link.",
    );
  if (g.players.length >= maxPlayers)
    throw Error(
      "Room full. Ask the host to remove an unused seat from the lobby.",
    );
  if (key) requested.joinKey = key;
  g.players.push(requested);
  return { player: requested, added: true };
}
