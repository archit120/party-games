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

// Call on the normal polling cadence: sockets push immediately; HTTP periodically
// reconciles the full state, and remains the fallback while reconnecting.
export function createRoomTransport({
  WebSocketImpl = globalThis.WebSocket,
  now = Date.now,
  random = Math.random,
} = {}) {
  const poll = createPollGate();
  let socket,
    active,
    options,
    healthy = false,
    lastPoll = -Infinity;
  let retryAt = 0,
    attempts = 0,
    openedAt = 0;
  function disconnect() {
    const old = socket;
    socket = null;
    healthy = false;
    if (old) old.close();
  }
  return async function sync(next) {
    options = next;
    if (active !== next.session) {
      disconnect();
      active = next.session;
      retryAt = 0;
      attempts = 0;
      lastPoll = -Infinity;
    }
    if (!active) return;
    if (socket && !healthy && now() - openedAt > 8000) disconnect();
    if (!socket && WebSocketImpl && now() >= retryAt) {
      const captured = active;
      try {
        const url = new URL("/api/live", location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const ws = (socket = new WebSocketImpl(url));
        openedAt = now();
        const current = () =>
          socket === ws && options.getSession() === captured;
        ws.onopen = () => {
          if (!current()) return ws.close();
          ws.send(JSON.stringify(next.credentials));
        };
        ws.onmessage = (event) => {
          if (!current()) return;
          try {
            const message = JSON.parse(event.data);
            if (
              message.type !== "state" ||
              message.state?.code !== next.credentials.code
            )
              return;
            healthy = true;
            attempts = 0;
            options.onState(message.state);
          } catch {
            ws.close();
          }
        };
        ws.onerror = () => ws.close();
        ws.onclose = () => {
          if (socket !== ws) return;
          socket = null;
          healthy = false;
          lastPoll = -Infinity;
          retryAt =
            now() +
            Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) *
              (0.8 + random() * 0.4);
        };
      } catch {
        socket = null;
        retryAt = now() + 5000;
      }
    }
    if (healthy && now() - lastPoll < 15000) return;
    lastPoll = now();
    return poll(next);
  };
}
