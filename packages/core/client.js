export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}
export async function request(path, body, token) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw Error("The server is reconnecting. Please try again in a moment.");
  let result;
  try {
    result = await r.json();
  } catch {
    throw Error("The connection was interrupted. Please try again.");
  }
  if (!r.ok) {
    const e = Error(result.error || "The request could not be completed.");
    e.status = r.status;
    throw e;
  }
  return result;
}

// A slow poll must never replace a newer action response or another room's seat.
export function newerState(current, incoming, revisionKey = "revision") {
  return (
    !!incoming &&
    (!current ||
      (incoming.code === current.code &&
        incoming[revisionKey] > current[revisionKey]))
  );
}
// One poll at a time, bound to the exact session that issued it.
export function createPollGate() {
  let running = false;
  return async function poll({ session, getSession, load, onState, onError }) {
    if (running || !session) return;
    running = true;
    try {
      const fresh = await load();
      if (getSession() === session) await onState(fresh);
    } catch (e) {
      if (getSession() === session) await onError(e);
    } finally {
      running = false;
    }
  };
}
