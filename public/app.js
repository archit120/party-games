const app = document.querySelector("#app"),
  error = document.querySelector("#error");
let state = null,
  busy = false,
  target = "",
  selected = [],
  polling = false;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const getSeats = () => {
  try {
    return JSON.parse(localStorage.getItem("coup-seats") || "{}");
  } catch {
    return {};
  }
};
let code = new URL(location.href).searchParams.get("room")?.toUpperCase() || "",
  token = getSeats()[code]?.token;
const name = (id) => state.players.find((p) => p.id === id)?.name || "Player";
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r
    .json()
    .catch(() => ({ error: "Connection interrupted. Try again." }));
  if (!r.ok) throw Error(data.error);
  return data;
}
const button = (label, type, data = {}, extra = "") =>
  `<button ${extra} data-action="${type}" data-payload="${esc(JSON.stringify(data))}">${label}</button>`;
function entrance() {
  const seats = getSeats();
  app.innerHTML = `<section class="welcome"><div><p class="eyebrow">A GAME OF BLUFF & INFLUENCE</p><h1>Claim power.<br>Keep your secrets.</h1><p class="lede">A court of hidden loyalties. Two cards, a handful of coins, and a lie worth believing.</p><div class="decor"><div class="crest">C</div><span>FIVE CHARACTERS. ONE SURVIVOR.</span></div></div><form id="entry"><p class="eyebrow">TAKE YOUR SEAT</p><h2>${code ? "Join the court" : "Gather your conspirators"}</h2><label>Your name<input name="name" maxlength="24" autocomplete="nickname" required placeholder="How shall we address you?"></label><label>Room code<input name="code" maxlength="6" value="${esc(code)}" placeholder="Leave blank to create a room" pattern="[A-Za-z]{6}"></label><button class="primary">${code ? "Join room" : "Enter the court"}</button><p class="muted">Share a room link with 2–6 friends.</p>${Object.entries(
    seats,
  )
    .map(
      ([c, s]) =>
        `<a class="resume" href="/?room=${c}">Resume ${esc(s.name)} · ${c} →</a>`,
    )
    .join("")}</form></section>`;
  document.querySelector("#entry").onsubmit = async (e) => {
    e.preventDefault();
    const b = new FormData(e.target),
      c = String(b.get("code")).trim().toUpperCase();
    try {
      busy = true;
      const data = await api(c ? "join" : "create", {
        name: b.get("name"),
        code: c,
      });
      token = data.token;
      state = data.view;
      code = state.code;
      const seats = getSeats();
      seats[code] = { token, name: b.get("name") };
      localStorage.setItem("coup-seats", JSON.stringify(seats));
      history.replaceState({}, "", `/?room=${code}`);
      error.textContent = "";
      render();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      busy = false;
    }
  };
}
function render() {
  if (!state) return entrance();
  const me = state.players.find((p) => p.id === state.me),
    q = state.pending;
  let controls = "",
    heading = "",
    hint = "";
  if (state.phase === "lobby") {
    heading = "The court is assembling";
    hint = "Invite your friends. Everyone joins on their own device.";
    controls =
      state.host === state.me
        ? button(
            "Begin game",
            "start",
            {},
            `class="primary" ${state.players.length < 2 ? "disabled" : ""}`,
          )
        : "<p>Waiting for the host to begin.</p>";
    controls += button("Leave seat", "leave", {}, 'class="quiet"');
  } else if (state.phase === "finished") {
    heading = `${esc(name(state.winner))} controls the court`;
    hint = "The last influence standing.";
    if (state.host === state.me)
      controls = button("Play again", "rematch", {}, 'class="primary"');
  } else if (state.phase === "turn") {
    heading =
      state.turn === state.me
        ? "Your move"
        : `${esc(name(state.turn))} is choosing`;
    hint = "A claim needs confidence. It does not need to be true.";
    if (state.turn === state.me) {
      const opponents = state.players.filter(
        (p) => p.id !== state.me && p.cards.some((c) => !c.revealed),
      );
      if (!opponents.some((p) => p.id === target)) target = opponents[0]?.id;
      controls =
        `<label>Target<select id="target">${opponents.map((p) => `<option value="${p.id}" ${p.id === target ? "selected" : ""}>${esc(p.name)} · ${p.coins} coins</option>`).join("")}</select></label><div class="actions">` +
        [
          ["income", "Income", "+1 coin"],
          ["aid", "Foreign aid", "+2 coins"],
          ["tax", "Tax", "Duke · +3 coins"],
          ["steal", "Steal", "Captain · take 2"],
          ["exchange", "Exchange", "Ambassador · draw 2"],
          ["assassinate", "Assassinate", "Assassin · pay 3"],
          ["coup", "Coup", "Pay 7 · unblockable"],
        ]
          .map(([a, title, desc]) =>
            button(
              `${title}<small>${desc}</small>`,
              a,
              { target },
              `${(me.coins >= 10 && a !== "coup") || (a === "coup" && me.coins < 7) || (a === "assassinate" && me.coins < 3) ? "disabled" : ""}`,
            ),
          )
          .join("") +
        "</div>";
    }
  } else if (state.phase === "loss") {
    heading =
      state.loss.id === state.me
        ? "Choose an influence to lose"
        : `${esc(name(state.loss.id))} must reveal`;
    hint = "Revealed cards are out of play.";
    if (state.loss.id === state.me)
      controls = me.cards
        .map((c, i) =>
          c.revealed
            ? ""
            : button(
                `Reveal ${c.role}`,
                "reveal",
                { index: i },
                'class="danger"',
              ),
        )
        .join("");
  } else if (state.phase === "exchange") {
    heading = state.exchange
      ? "Choose the cards to keep"
      : `${esc(name(q.actor))} is exchanging`;
    hint = "Only the exchanging player sees these cards.";
    if (state.exchange) {
      const e = state.exchange;
      controls = `<p>Keep ${e.count} card${e.count > 1 ? "s" : ""}.</p><div class="choices">${e.cards.map((r, i) => `<label><input type="checkbox" value="${i}" ${selected.includes(i) ? "checked" : ""}>${r}</label>`).join("")}</div><button id="keep" class="primary">Keep selected cards</button>`;
    }
  } else {
    heading =
      state.phase === "blockClaim"
        ? `${esc(name(q.blocker))} claims ${q.blockRole}`
        : `${esc(name(q.actor))} declares ${q.type}${q.target ? " against " + esc(name(q.target)) : ""}`;
    hint =
      state.phase === "claim"
        ? "Challenge the claimed character, or allow the claim. Blocking comes next."
        : state.phase === "block"
          ? "Block with a character claim, or allow the action."
          : "Challenge the block, or accept it.";
    if (state.canRespond) {
      controls = button(
        state.phase === "claim"
          ? "Allow claim"
          : state.phase === "block"
            ? "Allow action"
            : "Accept block",
        "pass",
        {},
        'class="primary"',
      );
      if (state.phase !== "block")
        controls += button("Challenge", "challenge", {}, 'class="danger"');
      else {
        const blocks =
          q.type === "aid"
            ? ["Duke"]
            : q.type === "steal"
              ? ["Captain", "Ambassador"]
              : ["Contessa"];
        controls += blocks
          .map((role) => button("Block · " + role, "block", { role }))
          .join("");
      }
    } else
      controls =
        '<p class="muted">Waiting for the other players to respond…</p>';
  }
  app.innerHTML = `<div class="roomhead"><div><p class="eyebrow">PRIVATE TABLE · ${state.players.length}/6 SEATS</p><h2>Room ${state.code}</h2></div><button id="invite" class="quiet">Copy invite link</button></div><div class="table-layout"><div><div class="players">${state.players.map((p) => `<article class="player ${p.id === state.turn ? "active" : ""} ${p.cards.length && !p.cards.some((c) => !c.revealed) ? "out" : ""}"><div class="playerhead"><b>${esc(p.name)} ${p.id === state.me ? '<span class="you">YOU</span>' : ""}</b><span class="coins">● ${p.coins}</span></div><div class="cards">${(p.cards.length ? p.cards : [{}, {}]).map((c) => `<div class="card ${c.revealed ? "revealed" : ""} ${c.role ? "known" : ""}"><span class="monogram">${c.role ? c.role[0] : "C"}</span><strong>${c.role || "Hidden influence"}</strong><small>${c.revealed ? "REVEALED" : p.id === state.me && c.role ? "ONLY YOU CAN SEE" : "THE COURT"}</small></div>`).join("")}</div></article>`).join("")}</div><section class="decision" aria-live="polite"><p class="eyebrow">${state.phase === "lobby" ? "LOBBY" : "THE NEXT MOVE"}</p><h2>${heading}</h2><p class="muted">${hint}</p><div class="controls">${controls}</div></section></div><aside><p class="eyebrow">PUBLIC RECORD</p><h2>Whispers & consequences</h2><ol>${
    [...state.log]
      .reverse()
      .map((l) => `<li>${esc(l)}</li>`)
      .join("") || "<li>The first move is still unwritten.</li>"
  }</ol></aside></div>`;
  app
    .querySelectorAll("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          act(b.dataset.action, JSON.parse(b.dataset.payload))),
    );
  app.querySelector("#target")?.addEventListener("change", (e) => {
    target = e.target.value;
    render();
  });
  app.querySelectorAll(".choices input").forEach(
    (i) =>
      (i.onchange = () => {
        selected = [...app.querySelectorAll(".choices input:checked")].map(
          (x) => Number(x.value),
        );
      }),
  );
  app
    .querySelector("#keep")
    ?.addEventListener("click", () => act("keep", { indices: selected }));
  app.querySelector("#invite").onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(location.origin + "/?room=" + code);
      e.target.textContent = "Link copied";
    } catch {
      error.textContent = "Invite link: " + location.origin + "/?room=" + code;
    }
  };
}
async function act(type, data) {
  if (busy) return;
  busy = true;
  try {
    const result = await api("action", { code, rev: state.rev, type, data });
    error.textContent = "";
    selected = [];
    if (result.left) {
      const seats = getSeats();
      delete seats[code];
      localStorage.setItem("coup-seats", JSON.stringify(seats));
      token = null;
      state = null;
      code = "";
      history.replaceState({}, "", "/");
      entrance();
    } else {
      state = result;
      render();
    }
  } catch (e) {
    error.textContent = e.message;
  } finally {
    busy = false;
  }
}
async function poll() {
  if (!token || busy || polling) return;
  polling = true;
  try {
    const next = await api("state?code=" + code);
    if (!state || state.rev !== next.rev) {
      state = next;
      render();
    }
  } catch (e) {
    error.textContent = e.message;
    if (!state) entrance();
  } finally {
    polling = false;
  }
}
entrance();
poll();
setInterval(poll, 1200);
