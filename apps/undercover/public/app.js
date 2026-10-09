import {
  escapeHTML as esc,
  readStored,
  request,
  newerState,
  createPollGate,
} from "/shared/client.js";
const app = document.querySelector("#app"),
  error = document.querySelector("#error");
let state = null,
  session = null,
  busy = false,
  polling = false,
  showSecret = false,
  draft = "",
  recovery = null;
const seats = () => readStored("undercover-seats", {}),
  room = () =>
    new URL(location.href).searchParams.get("room")?.toUpperCase() || "";
const api = (path, body) => request(path, body, session?.token);
const name = (id) => state.players.find((p) => p.id === id)?.name || "Player";
const button = (text, type, payload = {}, cls = "") =>
  `<button class="${cls}" data-action="${type}" data-payload="${esc(JSON.stringify(payload))}">${text}</button>`;
function remember(s) {
  const all = seats();
  all[s.code] = s;
  localStorage.setItem("undercover-seats", JSON.stringify(all));
}
function fail(e) {
  error.textContent = e.message || e;
}
function entrance() {
  const code = room(),
    valid = /^[A-Z]{6}$/.test(code);
  app.innerHTML = `<section class="welcome"><div><p class="eyebrow">3–12 PLAYERS · ONE SUSPICIOUS WORD</p><h1>Read between<br>their lines.</h1><p class="lede">You know your word. You think they know it too. One careful clue could give everything away.</p><div class="decor"><div class="crest">?</div><span>DESCRIBE. DOUBT. DISCOVER.</span></div></div><form id="entry"><p class="eyebrow">TAKE YOUR SEAT</p><h2>${code ? "Join room " + esc(code) : "A little friendly suspicion"}</h2><label>Your name<input name="name" maxlength="24" required autocomplete="nickname" placeholder="How shall we call you?"></label>${code ? "" : `<label>Room code<input name="code" maxlength="6" pattern="[A-Za-z]{6}" placeholder="Leave blank to create a room"></label>`}<button class="primary" ${code && !valid ? "disabled" : ""}>${code ? "Join room" : "Enter the room"}</button>${code && !valid ? "<p>This invite is invalid.</p>" : ""}<p class="muted">Everyone joins on their own device.</p>${Object.entries(
    seats(),
  )
    .map(
      ([c, s]) =>
        `<a class="resume" href="/?room=${esc(c)}">Resume ${esc(s.name)} · ${esc(c)} →</a>`,
    )
    .join("")}</form></section>`;
  document.querySelector("#entry").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const form = new FormData(e.target),
        name = String(form.get("name")),
        code =
          room() ||
          String(form.get("code") || "")
            .trim()
            .toUpperCase();
      if (code && seats()[code]) {
        location.assign("/?room=" + code);
        return;
      }
      const key = code + ":" + name.trim().toLowerCase(),
        attempts = readStored("undercover-joins", {});
      if (!attempts[key]) {
        attempts[key] = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        localStorage.setItem("undercover-joins", JSON.stringify(attempts));
      }
      const r = await api(code ? "/api/join" : "/api/create", {
        name,
        code,
        joinKey: attempts[key],
      });
      session = { code: r.code, token: r.token, name };
      remember(session);
      state = r.state;
      history.replaceState({}, "", "/?room=" + r.code);
      error.textContent = "";
      render();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  };
}
function render() {
  if (!state) return entrance();
  const me = state.me,
    host = state.host === me.id;
  let title = "",
    hint = "",
    controls = "";
  if (state.phase === "lobby") {
    title = "Gather your suspects";
    hint =
      "Civilians must outnumber the Undercover players and Mr. White combined.";
    controls = host
      ? `<form id="settings"><div class="settings"><label>Undercover players<select name="undercover">${[1, 2, 3].map((n) => `<option ${state.settings.undercover === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><input name="mrWhite" type="checkbox" ${state.settings.mrWhite ? "checked" : ""}> Include Mr. White</label><button>Save settings</button></div></form>` +
        button("Begin game", "start", {}, "primary")
      : "<p>Waiting for the host to begin.</p>";
    if (host && state.ai?.available)
      controls += `<button id="add-bot" ${state.players.filter((p) => p.bot).length >= state.ai.maxBots || state.players.length >= 12 ? "disabled" : ""}>Add AI player</button><p class="muted">${state.ai.modelAvailable ? "AI players use their own word and the public clues." : "AI provider unavailable: bots use basic fallback clues and random votes."} Up to ${state.ai.maxBots} AI seats. You open voting after discussion.</p>`;
    controls += `<button id="leave" class="quiet">Leave seat</button>`;
  } else if (state.phase === "clue") {
    title =
      state.turn === me.id
        ? "Your clue, carefully chosen"
        : `${esc(name(state.turn))} is giving a clue`;
    hint =
      "Describe your word without saying it. Your clue will be visible to everybody.";
    if (state.turn === me.id)
      controls = `<form id="clue"><label>A short clue<input id="clue-text" maxlength="80" required value="${esc(draft)}" autocomplete="off" placeholder="Just enough to fit in…"></label><button class="primary">Share clue</button></form>`;
  } else if (state.phase === "discussion") {
    title = "Something sounds different";
    hint =
      "Discuss the clues together. When ready, any living player can open the ballot.";
    if (me.alive || host)
      controls = button("Open voting", "openVote", {}, "primary");
  } else if (state.phase === "vote") {
    title = state.runoff ? "A closer look: runoff" : "Who is undercover?";
    hint =
      "Votes stay private until everybody has voted. Only the totals are revealed.";
    if (!me.alive) controls = "<p>You are observing this vote.</p>";
    else if (state.myVote)
      controls = "<p>Your vote is sealed. Waiting for the others…</p>";
    else
      controls =
        '<div class="ballot">' +
        state.candidates
          .filter((id) => id !== me.id)
          .map((id) => button(esc(name(id)), "vote", { target: id }))
          .join("") +
        "</div>";
    controls += `<p class="muted">${state.players.filter((p) => p.alive && p.voted).length}/${state.players.filter((p) => p.alive).length} votes sealed</p>`;
  } else if (state.phase === "guess") {
    title =
      state.guesser === me.id
        ? "One last chance, Mr. White"
        : `${esc(name(state.guesser))} has one last guess`;
    hint = "Guess the civilian word exactly to win.";
    if (state.guesser === me.id)
      controls =
        '<form id="guess"><label>Your guess<input name="word" maxlength="80" required autocomplete="off"></label><button class="primary">Guess the word</button></form>';
  } else if (state.phase === "finished") {
    title =
      state.winner === "civilians"
        ? "The civilians cracked it"
        : state.winner === "mrWhite"
          ? "Mr. White stole the win"
          : "The impostors blend in";
    hint = "The words are finally out.";
    controls =
      `<p class="words">Civilians: <b>${esc(state.words[0])}</b><br>Undercover: <b>${esc(state.words[1])}</b></p>` +
      (host
        ? button("Play again", "restart", {}, "primary")
        : "<p>Waiting for the host to open the next game.</p>");
  }
  const secret = !["lobby", "finished"].includes(state.phase)
    ? `<section class="secret"><p class="eyebrow">YOUR PRIVATE WORD</p><h2>${showSecret ? (me.wordless ? "You are Mr. White" : esc(me.word)) : "Keep it under cover"}</h2>${showSecret && me.wordless ? '<p class="muted">You have no word. Listen closely and blend in.</p>' : ""}<button id="secret-toggle" class="quiet">${showSecret ? "Hide word" : "Reveal my word"}</button></section>`
    : "";
  app.innerHTML = `<div class="roomhead"><div><p class="eyebrow">PRIVATE ROOM · ${state.players.length}/12 SEATS</p><h2>${state.code}${state.round && state.phase !== "lobby" ? " · Round " + state.round : ""}</h2></div><button id="invite" class="quiet">Copy invite link</button></div><div class="people">${state.players.map((p) => `<div class="person ${p.alive ? "" : "out"}"><b>${esc(p.name)}${p.id === me.id ? " · you" : ""}</b><small>${p.role ? esc(p.role === "mrWhite" ? "Mr. White" : p.role) : p.id === state.turn ? "Giving a clue" : p.id === state.host ? "Host" : "At the table"}${!p.alive ? " · eliminated" : ""}${p.botSource === "basic" ? " · basic fallback" : ""}</small>${host && !p.bot ? `<button data-recover="${p.id}">Recover seat</button>` : ""}${host && p.id !== me.id && state.phase === "lobby" ? `<button data-kick="${p.id}">Remove</button>` : ""}</div>`).join("")}</div>${recovery ? `<p class="recovery">Private recovery link for ${esc(recovery.name)} (15 minutes). Send only to that player: <a href="${esc(recovery.url)}">${esc(recovery.url)}</a></p>` : ""}<div class="table-layout"><div>${secret}<section class="decision" aria-live="polite"><p class="eyebrow">${state.phase.toUpperCase()}</p><h2>${title}</h2><p class="muted">${hint}</p><div class="controls">${controls}</div></section>${[
    ...new Set(state.clues.map((c) => c.round)),
  ]
    .reverse()
    .map(
      (r) =>
        `<p class="round">ROUND ${r} · THE CLUES</p><ul class="clues">${state.clues
          .filter((c) => c.round === r)
          .map(
            (c) =>
              `<li><b>${esc(name(c.id))}</b><span>${esc(c.text)}</span></li>`,
          )
          .join("")}</ul>`,
    )
    .join(
      "",
    )}</div><aside><p class="eyebrow">THE PUBLIC RECORD</p><h2>Clues & consequences</h2>${
    state.lastVote
      ? `<p class="muted">Last ballot · Round ${state.lastVote.round}</p><ul>${Object.entries(
          state.lastVote.counts,
        )
          .map(([id, n]) => `<li>${esc(name(id))}: ${n}</li>`)
          .join("")}</ul>`
      : ""
  }<ol>${
    [...state.log]
      .reverse()
      .map((s) => `<li>${esc(s)}</li>`)
      .join("") || "<li>Every secret starts somewhere.</li>"
  }</ol></aside></div>`;
  app
    .querySelectorAll("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          act(b.dataset.action, JSON.parse(b.dataset.payload))),
    );
  document.querySelector("#secret-toggle")?.addEventListener("click", () => {
    showSecret = !showSecret;
    render();
  });
  document
    .querySelector("#clue-text")
    ?.addEventListener("input", (e) => (draft = e.target.value));
  document.querySelector("#clue")?.addEventListener("submit", (e) => {
    e.preventDefault();
    act("clue", { text: draft });
  });
  document.querySelector("#guess")?.addEventListener("submit", (e) => {
    e.preventDefault();
    act("guess", { word: new FormData(e.target).get("word") });
  });
  document.querySelector("#settings")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act("settings", {
      undercover: Number(f.get("undercover")),
      mrWhite: f.has("mrWhite"),
    });
  });
  document.querySelector("#invite").onclick = async (e) => {
    const url = location.origin + "/?room=" + state.code;
    try {
      await navigator.clipboard.writeText(url);
      e.target.textContent = "Link copied";
    } catch {
      error.textContent = url;
    }
  };
  app
    .querySelectorAll("[data-kick]")
    .forEach(
      (b) => (b.onclick = () => roomAction("kick", { target: b.dataset.kick })),
    );
  app
    .querySelectorAll("[data-recover]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          roomAction("recovery", { target: b.dataset.recover })),
    );
  document
    .querySelector("#add-bot")
    ?.addEventListener("click", () => roomAction("bots", { operation: "add" }));
  document
    .querySelector("#leave")
    ?.addEventListener("click", () => roomAction("leave", {}));
}
async function roomAction(type, body) {
  if (busy) return;
  busy = true;
  try {
    const r = await api(`/api/rooms/${session.code}/${type}`, body);
    error.textContent = "";
    if (type === "recovery") {
      recovery = {
        name: r.name,
        url: location.origin + "/?room=" + session.code + "#recover=" + r.key,
      };
    } else if (type === "leave") {
      const all = seats();
      delete all[session.code];
      localStorage.setItem("undercover-seats", JSON.stringify(all));
      session = null;
      state = null;
      history.replaceState({}, "", "/");
    } else state = r;
    render();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}
async function act(type, payload) {
  if (busy) return;
  busy = true;
  try {
    state = await api(`/api/rooms/${session.code}/action`, {
      type,
      payload,
      revision: state.revision,
      voteId: state.voteId,
      gameId: state.gameId,
    });
    error.textContent = "";
    if (["clue", "restart", "start"].includes(type)) {
      draft = "";
      showSecret = false;
    }
    render();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}
const pollGate = createPollGate();
async function poll() {
  if (!session || busy) return;
  const current = session;
  return pollGate({
    session: current,
    getSession: () => session,
    load: () => api("/api/rooms/" + current.code),
    onState: (next) => {
      if (newerState(state, next)) {
        if (state?.gameId !== next.gameId) showSecret = false;
        state = next;
        render();
      }
    },
    onError: (e) => {
      fail(e);
      if (e.status === 401) {
        const all = seats();
        delete all[current.code];
        localStorage.setItem("undercover-seats", JSON.stringify(all));
        session = null;
        state = null;
        entrance();
      }
    },
  });
}
async function boot() {
  const key = new URLSearchParams(location.hash.slice(1)).get("recover");
  if (key) {
    history.replaceState({}, "", "/?room=" + room());
    try {
      session = await api("/api/recover", { code: room(), key });
      remember(session);
    } catch (e) {
      fail(e);
      entrance();
      return;
    }
  } else session = seats()[room()] || null;
  entrance();
  await poll();
}
boot();
setInterval(poll, 1200);
