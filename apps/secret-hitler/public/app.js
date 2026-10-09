import {
  escapeHTML as esc,
  readStored,
  request,
  newerState,
  createPollGate,
} from "/shared/client.js";
const $ = (s) => document.querySelector(s),
  app = $("#app");
let session = null,
  state,
  showSecret = false,
  busy = false,
  chatDraft = "",
  displayedGameId = null,
  discardSelection = null;
const discardKey = (s) =>
  JSON.stringify([s.code, s.gameId, s.electionId, s.phase, s.me.id, s.hand]);
const name = (id) => esc(state.players.find((p) => p.id === id)?.name || "—");
function error(e) {
  $("#error").textContent = e.message || e;
  setTimeout(() => ($("#error").textContent = ""), 6000);
}
async function api(path, body) {
  return request(path, body, session?.token);
}
function savedSeats() {
  return readStored("assembly-saved-seats", {});
}
function roomInURL() {
  const value = new URLSearchParams(location.search).get("room");
  return value === null ? null : value.trim().toUpperCase();
}
function roomURL(code) {
  return `${location.pathname}?room=${encodeURIComponent(code)}`;
}
function rememberSeat(seat) {
  const seats = savedSeats();
  seats[seat.code] = { ...seats[seat.code], ...seat };
  localStorage.setItem("assembly-saved-seats", JSON.stringify(seats));
}
function entrance() {
  session = null;
  state = null;
  localStorage.removeItem("assembly-session");
  location.assign(location.pathname);
}
async function leaveRoom() {
  if (busy) return;
  const current = session;
  const active = !["lobby", "finished"].includes(state.phase);
  if (
    active &&
    !confirm(
      "Return to the entrance? Your seat will be saved so you can resume. The game still needs your participation.",
    )
  )
    return;
  busy = true;
  try {
    if (state.phase === "lobby")
      await api(`/api/rooms/${current.code}/leave`, {});
    const seats = savedSeats();
    if (state.phase !== "lobby")
      seats[current.code] = {
        ...current,
        name: state.players.find((p) => p.id === state.me.id).name,
      };
    else delete seats[current.code];
    localStorage.setItem("assembly-saved-seats", JSON.stringify(seats));
    entrance();
  } catch (e) {
    error(e);
    await poll();
  } finally {
    busy = false;
  }
}
function landing() {
  const invite = roomInURL();
  const validInvite = invite !== null && /^[A-Z]{6}$/.test(invite);
  const form =
    invite !== null
      ? `<h2>Join room ${esc(invite || "—")}</h2><p class="hint">Enter your name to join this table.</p><form id="entry"><label for="name">YOUR NAME</label><input id="name" maxlength="24" placeholder="How shall we address you?" autocomplete="nickname" enterkeyhint="go" required><button class="primary" type="submit" ${validInvite ? "" : "disabled"}>Join room ${esc(invite)} →</button>${validInvite ? "" : '<p class="hint">This invite is invalid. Ask the host for a new link.</p>'}</form><p class="hint"><a href="${esc(location.pathname)}">Create a different room or enter a room code</a></p>`
      : `<h2>The assembly awaits.</h2><p class="hint">Gather your friends. Keep your identity secret.</p><form id="entry"><label for="name">YOUR NAME</label><input id="name" maxlength="24" placeholder="How shall we address you?" autocomplete="nickname" required><button class="primary" type="submit" id="create-room">Create a private room →</button><div class="divider">OR JOIN THE TABLE</div><label for="code">ROOM CODE</label><div class="join-row"><input id="code" maxlength="6" placeholder="ABCDEF" autocomplete="off"><button type="button" id="join">Join room</button></div><p class="hint">No accounts. Each player joins on their own device.<br>Best played together or on a voice call.</p></form>`;
  app.innerHTML = `<div class="landing"><section><p class="eyebrow">5–10 PLAYERS · ONE HIDDEN AGENDA</p><h1>Secret<br><i>Hitler.</i></h1><p class="intro">A fragile democracy. A table of familiar faces. Someone is not who they claim to be.</p><div class="meta"><span>DEBATE.</span><span>DECEIVE.</span><span>DECIDE.</span></div></section><section class="paper"><p class="eyebrow">TAKE YOUR SEAT</p>${form}<details class="quick-rules"><summary>First time? Start here.</summary><p>Everyone gets a secret role. Most players are Liberals, but hidden Fascists are working against them.</p><p>Each round, discuss whom to trust, vote for two leaders, and let them secretly choose a policy. Liberals want 5 Liberal policies; Fascists want 6 Fascist policies—or Hitler elected Chancellor after 3 Fascist policies.</p><p>You don’t need to memorize the rules. Open the help beneath each action to learn that step as you play.</p></details></section></div>`;
  const seats = Object.values(savedSeats()).filter(
    (seat) => seat.code !== invite,
  );
  if (seats.length) {
    const resume = document.createElement("section");
    resume.className = "panel";
    resume.innerHTML = `<h3>Your saved seats</h3><p class="small">Your other seats are preserved. Games already in progress still need your participation.</p><div class="choices">${seats.map((seat) => `<button data-resume="${esc(seat.code)}">Resume ${esc(seat.code)} · ${esc(seat.name)}</button>`).join("")}</div>`;
    app.append(resume);
    resume.querySelectorAll("[data-resume]").forEach((button) => {
      button.onclick = () => location.assign(roomURL(button.dataset.resume));
    });
  }
  $("#entry").onsubmit = (e) => {
    e.preventDefault();
    if (invite !== null && !validInvite) return;
    enter(invite !== null || $("#code")?.value.trim() ? "join" : "create");
  };
  if ($("#join"))
    $("#join").onclick = () => {
      if ($("#entry").reportValidity()) enter("join");
    };
  if ($("#code"))
    $("#code").oninput = () => {
      $("#create-room").textContent = $("#code").value.trim()
        ? "Join room →"
        : "Create a private room →";
    };
}
async function enter(type) {
  if (busy) return;
  busy = true;
  try {
    const code = roomInURL() ?? $("#code")?.value.trim().toUpperCase();
    if (type === "join" && savedSeats()[code]) {
      location.assign(roomURL(code));
      return;
    }
    const enteredName = $("#name").value;
    const attemptId = `${code}:${enteredName.trim().toLowerCase()}`;
    const attempts = readStored("assembly-join-attempts", {});
    let joinKey;
    if (type === "join") {
      joinKey =
        attempts[attemptId] ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
      attempts[attemptId] = joinKey;
      localStorage.setItem(
        "assembly-join-attempts",
        JSON.stringify(Object.fromEntries(Object.entries(attempts).slice(-20))),
      );
    }
    const r = await api("/api/" + type, {
      name: enteredName,
      code,
      joinKey,
    });
    session = { code: r.code, token: r.token };
    localStorage.setItem("assembly-session", JSON.stringify(session));
    rememberSeat({
      ...session,
      name: r.state.players.find((p) => p.id === r.state.me.id).name,
    });
    location.assign(roomURL(r.code));
  } catch (e) {
    let notice = $("#entry-error");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "entry-error";
      notice.setAttribute("role", "alert");
      $("#entry").append(notice);
    }
    notice.textContent = e.message;
  } finally {
    busy = false;
  }
}
const button = (text, type, payload = {}, cls = "") =>
  `<button class="${cls}" data-action="${type}" data-payload="${esc(JSON.stringify(payload))}">${text}</button>`;
function stepHelp() {
  const s = state;
  const commonWin =
    "<b>Liberals:</b> enact 5 Liberal policies or execute Hitler. <b>Fascists:</b> enact 6 Fascist policies, or elect Hitler Chancellor after 3 Fascist policies.";
  const guides = {
    lobby: [
      "The game in a minute",
      "<p>You will get a secret role: Liberal, Fascist, or Hitler. Keep it private. Talk in person or on a voice call and try to work out whom to trust.</p><p><b>Each round:</b> nominate two leaders → everyone votes → elected leaders secretly choose a policy. You can bluff about your secret information.</p><p>" +
        commonWin +
        '</p><p class="help-next">For now: invite 5–10 people. The host starts once everyone is ready. We’ll explain each step as it comes.</p>',
    ],
    nominate: [
      "Why choose a Chancellor?",
      '<p>The President proposes a partner called the <b>Chancellor</b>. Together, they will choose the next policy—but only if the table elects them.</p><p>Discuss whom you trust. Only eligible choices appear. The last elected Chancellor is ineligible; with more than 5 living players, the last elected President is too.</p><p class="help-next">Next: everyone votes on the proposed pair. Being nominated does not automatically give them power.</p>',
    ],
    vote: [
      "What am I voting for?",
      "<p>You’re voting on <b>both proposed leaders as a pair</b>, not on a policy. Choose <b>Ja</b> if you want this government, or <b>Nein</b> if you don’t.</p><p>Your ballot stays hidden until everyone has voted. More than half of living players must vote Ja; a tie fails. A submitted vote cannot be changed.</p><p>" +
        (s.Fascist >= 3
          ? "<b>Watch out:</b> electing Hitler as Chancellor now immediately gives the Fascists the win."
          : "Trust matters: elected leaders will choose a policy in secret.") +
        '</p><p class="help-next">If the vote fails, the presidency moves on. After three failed elections, the top policy is enacted automatically.</p>',
    ],
    "president-discard": [
      "Why am I discarding a card?",
      '<p>The President receives <b>three secret policies</b> and must deliberately discard one. The other two go to the Chancellor.</p><p><b>Click the card you want to throw away.</b> Discards stay face down. No talking or signaling between the leaders during this session.</p><p class="help-next">The Chancellor will discard one of the remaining two. The last card becomes law. Afterward, players can discuss or bluff about what they saw.</p>',
    ],
    "chancellor-discard": [
      "Which card becomes the policy?",
      '<p>The Chancellor receives <b>two policies</b> from the President. Discard one; the <b>other card is enacted</b> on the board.</p><p>Example: if you see one Liberal and one Fascist policy and want a Liberal policy, discard the Fascist card. Keep this decision private and do not communicate with the President.</p><p class="help-next">' +
        (s.Fascist >= 5
          ? "Veto is unlocked: you may ask to discard both cards. The President must agree; a rejected veto means you must enact a policy."
          : "A Fascist policy may give the President a special power. Otherwise, a new round begins.") +
        "</p>",
    ],
    veto: [
      "What happens if the veto passes?",
      '<p>The Chancellor wants to discard both remaining policies. The President chooses whether to agree.</p><p><b>Accept:</b> discard both cards and advance the election tracker. <b>Reject:</b> the Chancellor must choose a policy and cannot ask again this round.</p><p class="help-next">An accepted veto counts as a failed government. It can trigger the third failure and an automatic policy.</p>',
    ],
    finished: [
      "Why did the game end?",
      "<p>" +
        esc(s.reason) +
        "</p><p>" +
        commonWin +
        '</p><p class="help-next">All roles are now public. Compare the clues, then return to the entrance to create a new game.</p>',
    ],
  };
  const powers = {
    peek: [
      "What does Policy Peek reveal?",
      '<p>The President privately sees the next three policies in their exact order. No cards move or get discarded.</p><p class="help-next">Use the power to see the three cards immediately in a private window. You can reopen them with View private intelligence. You may tell the table the truth—or lie.</p>',
    ],
    investigate: [
      "What does an investigation reveal?",
      '<p>Choose another living player who has not been investigated before. You learn their <b>party membership</b>, not their exact role.</p><p><b>Hitler’s membership is Fascist.</b> An investigation cannot tell Hitler apart from another Fascist.</p><p class="help-next">The result appears immediately in a private window and is saved in your private intelligence. You may share it or bluff about it.</p>',
    ],
    special: [
      "How does a special election work?",
      '<p>Choose another living player to be the next Presidential candidate—even someone who recently held office.</p><p>They nominate an eligible Chancellor and the table votes as usual. Normal Chancellor term limits still apply.</p><p class="help-next">After that election’s round, the presidency returns to the next living player after the President who called it.</p>',
    ],
    execute: [
      "What happens when someone is executed?",
      '<p>Choose another living player to remove from the game. This is permanent. They cannot speak, vote, or hold office.</p><p><b>If they are Hitler, the Liberals immediately win.</b> Otherwise, their role stays secret.</p><p class="help-next">Discuss your suspicions first. The President makes the final decision.</p>',
    ],
  };
  const guide = s.phase === "power" ? powers[s.power] : guides[s.phase];
  if (!guide) return "";
  return `<details class="step-help" id="step-help" ${localStorage.getItem("assembly-guidance") === "open" ? "open" : ""}><summary>${guide[0]}</summary><div class="help-content">${guide[1]}</div></details>`;
}
function turnCue() {
  const s = state,
    me = s.me.id,
    living = s.players.find((p) => p.id === me).alive;
  if (s.phase === "finished") return "";
  let text = "Discuss with your table.",
    your = false;
  if (s.phase === "lobby")
    text =
      s.host === me
        ? "You’re the host. Start when everyone is here."
        : "Waiting for the host to start.";
  else if (!living)
    text = "You’re observing. Please stay silent for the rest of the game.";
  else if (s.phase === "nominate") {
    your = s.president === me;
    text = your
      ? "Your move: nominate a Chancellor."
      : "Discuss candidates while the President chooses.";
  } else if (s.phase === "vote") {
    your = !s.voted.includes(me);
    text = your
      ? "Your vote: choose Ja or Nein."
      : "✓ Your vote is sealed. Waiting for the others.";
  } else if (s.phase === "power") {
    your = s.president === me;
    text = your
      ? "Your move: use the executive power."
      : "The President must use this power before play continues.";
  } else {
    your =
      (s.phase === "chancellor-discard" ? s.chancellor : s.president) === me;
    text = your
      ? s.phase === "veto"
        ? "Your move: accept or reject the veto."
        : "Your move: discard one of your cards."
      : "Private session: let the leaders decide in silence.";
  }
  return `<div class="turn-cue ${your ? "your-turn" : ""}">${text}</div>`;
}

function votingProgress() {
  if (state.phase !== "vote") return "";
  const players = state.players.filter((p) => p.alive);
  const waiting = players.filter((p) => !state.voted.includes(p.id));
  return `<section class="ballot-progress" aria-label="Voting progress"><div class="ballot-progress-title"><b>Waiting for ${waiting.length} ${waiting.length === 1 ? "player" : "players"}</b><span>${state.voted.length} / ${players.length} ballots sealed</span></div><div class="ballot-players">${players.map((p) => `<span class="ballot-player ${state.voted.includes(p.id) ? "submitted" : "pending"}"><span aria-hidden="true">${state.voted.includes(p.id) ? "✓" : "○"}</span> ${esc(p.name)}${p.id === state.me.id ? " (you)" : ""}<small>${state.voted.includes(p.id) ? "Sealed" : p.bot ? "Choosing…" : "Not voted"}</small></span>`).join("")}</div></section>`;
}
function controls() {
  const s = state,
    me = s.me.id,
    pres = s.president === me;
  let title = "",
    text = "",
    actions = "";
  if (s.phase === "lobby") {
    title = "A few more familiar faces.";
    text = `${s.players.length} of 10 seats filled. You need at least 5 players. Share the room code and gather on a voice call.`;
    if (s.players.length >= 5 && s.host === me)
      actions = button("Deal roles & begin", "start");
    else
      text +=
        s.host === me
          ? " You can start once everyone is here."
          : " The host will start the game.";
  } else if (s.phase === "finished") {
    title = s.winner ? `${s.winner} win.` : "Game ended.";
    text =
      s.reason +
      (s.host === me
        ? " Play again to keep this room and its players. The next game starts from a fresh lobby."
        : " The host can return everyone to the lobby for another game.");
    actions =
      (s.host === me ? button("Play again", "restart") : "") +
      '<button class="quiet" id="new-table">Return to entrance</button>';
  } else if (s.phase === "nominate") {
    title = pres
      ? "Choose your Chancellor."
      : `${name(s.president)} is nominating.`;
    text =
      "Discuss the next government. Term-limited players cannot be nominated.";
    if (pres)
      actions = s.eligible
        .map((id) => button(name(id), "nominate", { target: id }))
        .join("");
  } else if (s.phase === "vote") {
    title = `${name(s.president)} + ${name(s.chancellor)}`;
    text = `Vote on the proposed government. ${s.voted.length}/${s.players.filter((p) => p.alive).length} votes cast. Ballots reveal together.`;
    if (s.players.find((p) => p.id === me).alive && !s.voted.includes(me))
      actions =
        button("Ja! • Yes", "vote", { yes: true }) +
        button("Nein! • No", "vote", { yes: false }, "nein");
    else text += " Your ballot is sealed, or you are observing.";
  } else if (["president-discard", "chancellor-discard"].includes(s.phase)) {
    title = "The legislative session.";
    text = `${name(s.phase === "president-discard" ? s.president : s.chancellor)} must secretly discard one policy. No communication during this session.`;
    if (s.hand.length) {
      title = "Choose a card to DISCARD.";
      text =
        s.phase === "president-discard"
          ? "The selected card is thrown away. The other two go to the Chancellor. Select a card, then confirm below."
          : "The selected card is thrown away. The OTHER card becomes law. Select a card, then confirm below.";
      const selected = discardSelection?.index;
      actions = s.hand
        .map((p, i) => {
          const marked = selected === i;
          return `<button class="policy ${p.toLowerCase()}${marked ? " marked-discard" : ""}" data-action="select-discard" data-payload='{"index":${i}}' aria-pressed="${marked}" aria-label="Select ${p} card ${i + 1} to discard"><span class="policy-overline">${marked ? "THROW AWAY" : "SELECT TO DISCARD"}</span>${icon(p.toLowerCase())}<b>${p}</b><span class="policy-lines"></span><span class="discard-label">${marked ? "✓ Marked for discard" : "Discard this card"}</span></button>`;
        })
        .join("");
      if (selected !== undefined) {
        const remaining = s.hand.filter((_, i) => i !== selected);
        actions += `<div class="discard-preview" role="status"><p><strong>Discard:</strong> ${esc(s.hand[selected])}</p><p><strong>${s.phase === "president-discard" ? "Pass to Chancellor" : "Enact as law"}:</strong> ${remaining.map(esc).join(" + ")}</p><div class="discard-confirm">${button(`Confirm discard: ${esc(s.hand[selected])}`, "discard", { index: selected })}${button("Cancel selection", "cancel-discard", {}, "quiet")}</div></div>`;
      }
      if (s.phase === "chancellor-discard" && s.Fascist >= 5 && !s.vetoDenied)
        actions += button("Request veto", "veto");
    }
  } else if (s.phase === "veto") {
    title = "A veto has been requested.";
    text =
      "The President must consent to discard this agenda. An accepted veto advances the election tracker.";
    if (pres)
      actions =
        button("Accept veto", "respond-veto", { yes: true }) +
        button("Reject veto", "respond-veto", { yes: false }, "nein");
  } else if (s.phase === "power") {
    const labels = {
      peek: "Policy peek",
      investigate: "Investigate loyalty",
      special: "Call a special election",
      execute: "Execute a player",
    };
    title = labels[s.power];
    text = {
      peek: `${name(s.president)} privately looks at the next three policies.`,
      investigate: `${name(s.president)} chooses someone to privately learn their party membership.`,
      special: `${name(s.president)} chooses the next Presidential candidate for one special election.`,
      execute: `${name(s.president)} must execute a player. If they are Hitler, the Liberals win.`,
    }[s.power];
    if (pres) {
      if (s.power === "peek")
        actions = button("Privately view top 3 policies", "power");
      else
        actions = s.players
          .filter(
            (p) =>
              p.alive &&
              p.id !== me &&
              (s.power !== "investigate" || !s.investigated.includes(p.id)),
          )
          .map((p) =>
            button(
              esc(p.name),
              "power",
              { target: p.id },
              s.power === "execute" ? "nein" : "",
            ),
          )
          .join("");
    }
  }
  return `<section class="action ${s.phase}" aria-live="polite"><div class="action-heading"><span class="action-mark">${icon(s.phase === "power" ? s.power : s.phase === "vote" ? "special" : s.phase === "finished" ? "victory" : "seal")}</span><p class="eyebrow">${s.phase === "lobby" ? "WAITING ROOM" : s.phase === "finished" ? "THE FINAL VERDICT" : "THE FLOOR IS OPEN"}</p></div><h3>${title}</h3>${turnCue()}<p>${text}</p><div class="choices">${actions}</div>${votingProgress()}${stepHelp()}</section>`;
}
const symbols = {
  liberal:
    '<path d="M13 40c10 0 18-9 21-20 2 5 6 7 13 7-1 7-6 13-13 15-5 1-9 0-12-2l-9 6 2-9-6-6 9 1"/><path d="M35 20l7-7 2 9M22 40l-6 14m1-5l-7-2m10-4l4 6"/>',
  fascist:
    '<path d="M36 8L17 34h13l-3 22 21-30H35z"/><path d="M11 54h9m23 0h10M9 15l6 4m34-4l-6 4"/>',
  seal: '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="17"/><path d="M23 28l9-6 9 6-9 6zm0 8l9 6 9-6M32 13v4m0 30v4M13 32h4m30 0h4"/>',
  investigate:
    '<circle cx="27" cy="27" r="14"/><path d="M37 37l16 16M21 27h12m-6-6v12"/>',
  peek: '<path d="M5 32s10-16 27-16 27 16 27 16-10 16-27 16S5 32 5 32z"/><circle cx="32" cy="32" r="8"/>',
  special:
    '<path d="M15 17h34v30H15zM24 10v14m16-14v14M15 27h34m-24 9l7 5 9-10"/>',
  execute:
    '<path d="M20 12l32 40M44 12L12 52M17 8l8 7-8 7-7-8m29-6l-7 7 7 7 8-8M8 48l8 8m32-8l8 8"/>',
  victory:
    '<path d="M21 14h22v14c0 10-22 10-22 0zM21 18H11v7c0 8 10 8 10 8m22-15h10v7c0 8-10 8-10 8M32 36v14m-12 3h24"/>',
  lock: '<rect x="17" y="27" width="30" height="26" rx="3"/><path d="M23 27V18a9 9 0 0118 0v9M32 37v7"/>',
};
function icon(type, cls = "") {
  return `<svg class="symbol ${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[type] || symbols.seal}</svg>`;
}
function track(team, total) {
  const s = state,
    labels = {
      peek: "Policy peek",
      investigate: "Investigate",
      special: "Special election",
      execute: "Execution",
      victory: "Victory",
    };
  return `<section class="track ${team.toLowerCase()}" aria-label="${team} policy track"><div class="track-title"><div class="track-heading">${icon(team.toLowerCase())}<div><span class="eyebrow">${team === "Liberal" ? "PROTECT THE REPUBLIC" : "SEIZE CONTROL"}</span><h3>${team} policies</h3></div></div><span class="track-count"><b>${s[team]}</b> / ${total}</span></div><div class="slots">${Array.from(
    { length: total },
    (_, i) => {
      const power =
        i === total - 1 ? "victory" : team === "Fascist" ? s.powers[i] : null;
      return `<div class="slot ${i < s[team] ? "filled" : ""}" aria-label="Policy ${i + 1}${i < s[team] ? ", enacted" : ""}${power ? ", " + labels[power] : ""}">${i < s[team] ? `<span class="policy-overline">ENACTED</span>${icon(team.toLowerCase())}<strong>${team}</strong><span class="card-rule"></span>` : `<span class="slot-number">${["I", "II", "III", "IV", "V", "VI"][i]}</span>${power ? icon(power) : '<span class="slot-diamond">◇</span>'}<span class="slot-label">${power ? labels[power] : "Policy slot"}</span>`}</div>`;
    },
  ).join(
    "",
  )}</div><div class="track-foot">${team === "Liberal" ? "Five policies. One surviving democracy." : s.Fascist >= 5 ? "Veto power is unlocked." : s.Fascist >= 3 ? "Hitler elected Chancellor = Fascist victory." : "After the third policy, electing Hitler ends the game."}<span>${team === "Liberal" ? "LIBERTY & REASON" : "POWER & DECEPTION"}</span></div></section>`;
}
function cardPiles() {
  const s = state;
  return `<section class="table-tools"><div class="deck-area"><div class="piles"><div class="pile-item"><div class="card-stack draw-stack" aria-label="Draw pile: ${s.deckCount} hidden policies"><div class="card-back">${icon("seal")}<span>THE ASSEMBLY</span><small>POLICY DECK</small></div></div><div class="pile-caption"><strong>Draw pile</strong><span>${s.deckCount} cards</span></div></div><div class="deck-divider"><span>↔</span><small>RESHUFFLE<br>BELOW 3</small></div><div class="pile-item"><div class="card-stack discard-stack ${s.discardCount === 0 ? "empty-stack" : ""}" aria-label="Discard pile: ${s.discardCount} hidden policies"><div class="card-back">${icon(s.discardCount ? "seal" : "lock")}<span>${s.discardCount ? "CLASSIFIED" : "EMPTY"}</span><small>DISCARD PILE</small></div></div><div class="pile-caption"><strong>Discard pile</strong><span>${s.discardCount} cards</span></div></div></div><div class="deck-composition"><span class="mix-label">STARTING DECK · 17 CARDS</span><div class="mix"><span class="mix-liberal">6 Liberal</span><span class="mix-fascist">11 Fascist</span></div><details><summary>How many are still unplayed?</summary><p><b>${6 - s.Liberal} Liberal · ${11 - s.Fascist} Fascist</b><br>Across the draw pile, discard pile, and any cards in players’ hands. The exact mix in each pile is secret.</p></details></div></div><div class="election-meter"><p class="eyebrow">PUBLIC PATIENCE</p><h3>${s.tracker === 0 ? "A moment of calm." : s.tracker === 1 ? "Doubt is growing." : "On the brink of chaos."}</h3><div class="tracker" aria-label="${s.tracker} of 3 failed elections">${[1, 2, 3].map((i) => `<span class="tracker-stop ${i <= s.tracker ? "on" : ""}">${i === 3 ? "!" : i}</span>${i < 3 ? '<span class="tracker-line"></span>' : ""}`).join("")}</div><p>Three failed elections enact the top policy.<br>No executive power. A fresh start.</p></div></section>`;
}
function roster() {
  const s = state;
  return `<section class="panel roster-panel"><div class="section-heading"><h3>The assembly</h3><span class="eyebrow">${s.players.filter((p) => p.alive).length} AT THE TABLE</span></div>${s.roleCounts ? `<div class="role-distribution" aria-label="Starting role counts"><span>${s.phase === "lobby" ? "Roles to deal" : "Roles dealt"}</span><b>${s.roleCounts.Liberal} Liberals</b><b>${s.roleCounts.Fascist} Fascist${s.roleCounts.Fascist === 1 ? "" : "s"}</b><b>${s.roleCounts.Hitler} Hitler</b><small>Starting totals · Hitler is listed separately.</small></div>` : ""}<div class="players">${s.players.map((p, i) => `<div class="player seat-color-${i % 5} ${p.alive ? "" : "dead"} ${p.id === s.president ? "presidential" : ""}"><span class="seat">${String(i + 1).padStart(2, "0")}${p.id === s.host ? "<span>HOST</span>" : p.bot ? "<span>AI</span>" : ""}</span><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}${p.id === s.president ? '<span class="office-pin">P</span>' : p.id === s.chancellor ? '<span class="office-pin">C</span>' : ""}</div><strong>${esc(p.name)}</strong>${p.id === s.me.id ? '<span class="you-label">YOU</span>' : ""}<small>${!p.alive ? "EXECUTED" : p.id === s.president ? "PRESIDENT" : p.id === s.chancellor ? "CHANCELLOR" : s.voted.includes(p.id) && s.phase === "vote" ? "✓ BALLOT SEALED" : "ASSEMBLY MEMBER"}${p.role ? " · " + p.role : ""}</small>${p.bot && p.botSource === "basic" ? '<span class="basic-bot">Basic fallback</span>' : ""}${p.bot && s.phase === "lobby" && s.host === s.me.id ? `<button class="remove-ai" data-remove-ai="${p.id}" aria-label="Remove ${esc(p.name)}">Remove AI</button>` : !p.bot && p.id !== s.host && s.phase === "lobby" && s.host === s.me.id ? `<button class="remove-ai" data-kick="${p.id}" aria-label="Kick ${esc(p.name)}">Kick</button>` : ""}${!p.bot && s.host === s.me.id ? `<button class="remove-ai" data-recover="${p.id}">Recover seat</button>` : ""}</div>`).join("")}</div></section>`;
}
function showIntelligence() {
  if (!state?.me.notes.length) return;
  $("#intelligence-content").innerHTML = state.me.notes
    .slice()
    .reverse()
    .map((note) => {
      const cards = note.startsWith("Policy peek:")
        ? note.match(/\b(Liberal|Fascist)\b/g)
        : null;
      return cards?.length === 3
        ? `<section class="intel-entry"><h3>The next three policies</h3><p>Recorded at the moment of your peek. The first card is on top; the order has not been changed.</p><div class="peek-cards">${cards.map((card, i) => `<div class="peek-card ${card.toLowerCase()}"><span>${i === 0 ? "1 · TOP CARD" : i + 1 + " · NEXT"}</span>${icon(card.toLowerCase())}<b>${card}</b></div>`).join("")}</div><p class="intel-footnote">This is a saved snapshot, not a live view of the deck. Keep it private—or tell the table what you choose.</p></section>`
        : `<section class="intel-entry"><h3>Investigation result</h3><p>${esc(note)}</p><p class="intel-footnote">Party membership does not distinguish Hitler from another Fascist.</p></section>`;
    })
    .join("");
  if (!$("#private-intelligence").open) $("#private-intelligence").showModal();
}
function aiSetup() {
  const s = state,
    bots = s.players.filter((p) => p.bot),
    host = s.host === s.me.id;
  const label = s.ai?.model?.includes("glm")
    ? "GLM-5.3 Flash"
    : esc(s.ai?.model || "AI");
  return `<section class="panel ai-setup"><div class="section-heading"><h3>An extra seat at the table</h3><span class="ai-tag">OPTIONAL AI</span></div><p class="small">AI players make their own choices from public events and their private cards. They can bluff, but they can’t hear your voice call.</p>${host ? `<button class="quiet" id="add-ai" ${!s.ai?.available || bots.length >= (s.ai?.maxBots ?? 4) || s.players.length >= 10 ? "disabled" : ""}>＋ Add AI player</button><span class="ai-count">${bots.length} / ${s.ai?.maxBots ?? 4} AI seats · ${label}</span>${bots.length ? `<label class="ai-toggle"><input type="checkbox" id="ai-comments" ${s.aiComments ? "checked" : ""}> Let AI players share short table comments</label>` : ""}${!s.ai?.available ? '<p class="small">AI seats are not configured on this server yet.</p>' : ""}` : '<p class="small">The host can add or remove AI players before the game starts.</p>'}</section>`;
}
function aiTableTalk() {
  const s = state;
  const privatePhase = [
    "president-discard",
    "chancellor-discard",
    "veto",
  ].includes(s.phase);
  const dead =
    !s.players.find((p) => p.id === s.me.id)?.alive && s.phase !== "finished";
  const blocked = privatePhase || dead;
  const messages = [...(s.botComments ?? []), ...(s.chatMessages ?? [])]
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .slice(-30)
    .reverse();
  return `<section class="panel ai-talk"><div class="section-heading"><h3>Table talk</h3><span class="ai-tag">PUBLIC CHAT</span></div><p class="small">Everyone at this table can read this. Players and AI may bluff.${s.players.some((p) => p.bot) ? (s.aiComments ? " Mention AI players by name; up to two can reply when relevant." : " AI replies are turned off.") : ""}</p><div class="ai-comments" aria-live="polite">${messages.length ? messages.map((c) => `<article><b>${esc(c.name)}</b>${c.policyNumber ? `<p class="small">After policy ${c.policyNumber} · ${esc(c.policy)}</p>` : ""}<p>${esc(c.text)}</p></article>`).join("") : '<p class="small">Start the conversation.</p>'}</div><form id="chat-form"><label for="chat-input">Message the table</label><textarea id="chat-input" maxlength="400" rows="2" placeholder="Who do you trust?" ${blocked ? "disabled" : ""}>${esc(chatDraft)}</textarea><button class="quiet" type="submit" ${blocked ? "disabled" : ""}>Send message</button><p class="small">${privatePhase ? "Chat pauses during private legislation. Discuss after the reveal." : dead ? "Executed players must stay silent until the game ends." : "Up to 400 characters. AI replies may take a few seconds."}</p></form></section>`;
}
async function sendChat(event) {
  event.preventDefault();
  if (busy || !chatDraft.trim()) return;
  busy = true;
  try {
    state = await api(`/api/rooms/${state.code}/chat`, { text: chatDraft });
    chatDraft = "";
    render();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
  }
}

async function manageBots(operation, extra = {}) {
  if (busy) return;
  busy = true;
  try {
    state = await api(`/api/rooms/${state.code}/bots`, { operation, ...extra });
    render();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
  }
}
function identity() {
  const s = state;
  return `<section class="panel identity-panel"><div class="section-heading"><h3>Your identity</h3>${icon("lock")}</div><div class="secret ${showSecret && s.me.role ? "unsealed " + s.me.role.toLowerCase() : "sealed"}">${s.me.role && showSecret ? `<span class="eyebrow">YOUR SECRET ROLE</span>${icon(s.me.role === "Liberal" ? "liberal" : "fascist", "role-symbol")}<div class="role">${s.me.role}</div><p>${s.me.role === "Liberal" ? "Protect the republic.<br>Find the truth." : "You are on the Fascist team."}</p>${s.me.allies.map((p) => `<div class="ally">${esc(p.name)} <b>${p.role}</b></div>`).join("")}<button class="quiet" id="secret">Hide identity</button><details class="role-help"><summary>How does my team win?</summary><p>${s.me.role === "Liberal" ? "Enact 5 Liberal policies or execute Hitler. You don’t know who your teammates are. Compare votes and claims to find people you can trust." : s.me.role === "Hitler" ? "Your team wins with 6 Fascist policies, or if you are elected Chancellor after 3 Fascist policies. Build trust and protect your identity." : "Your team wins with 6 Fascist policies, or by electing Hitler Chancellor after 3 Fascist policies. Keep Hitler alive and use your knowledge of your teammates."}</p></details>` : `<div class="wax-seal">${icon("seal")}</div><span class="classified">STRICTLY CONFIDENTIAL</span><p>${s.me.role ? "Some secrets change everything.<br>Keep this one to yourself." : "Your secret is waiting.<br>Roles are dealt when the game begins."}</p>${s.me.role ? '<button class="quiet" id="secret">Reveal identity</button>' : '<span class="sealed-note">SEALED UNTIL THE FIRST ELECTION</span>'}`}</div>${s.me.notes.length ? `<button class="quiet intel-button" id="view-intelligence">${icon("peek")} View private intelligence (${s.me.notes.length})</button>` : ""}</section>`;
}
function phaseRibbon() {
  const phases = ["nominate", "vote", "legislate", "power"];
  const current =
    state.phase.includes("discard") || state.phase === "veto"
      ? "legislate"
      : state.phase;
  return `<div class="phase-ribbon" aria-label="Round stages">${phases.map((p, i) => `<span class="${p === current ? "current" : ""}"><b>0${i + 1}</b> ${["Nominate", "Vote", "Legislate", "Executive action"][i]}</span>`).join("")}</div>`;
}

function render() {
  if (discardSelection?.key !== discardKey(state)) discardSelection = null;
  const gameId = state.gameId ?? 1;
  if (displayedGameId !== null && displayedGameId !== gameId) {
    showSecret = false;
    chatDraft = "";
    $("#private-intelligence").close();
    $("#seat-recovery").close();
  }
  displayedGameId = gameId;
  const chatFocused = document.activeElement?.id === "chat-input";
  const chatSelection = chatFocused
    ? [$("#chat-input").selectionStart, $("#chat-input").selectionEnd]
    : null;
  const s = state;
  app.innerHTML = `<div class="room-head"><div><p class="eyebrow"><span class="live-dot"></span> PRIVATE ASSEMBLY <span id="connection">● CONNECTED</span></p><h2>${s.phase === "lobby" ? "Good company. Bad intentions." : s.phase === "finished" ? "The masks come off." : "Trust is on the table."}</h2></div><div class="room-invite"><div class="room-ticket"><span>ROOM NO.</span><b>${s.code}</b></div><div class="room-buttons"><button class="quiet" id="invite">Copy invite link ↗</button><button class="quiet" id="leave-room">Leave room</button>${s.host === s.me.id && !["lobby", "finished"].includes(s.phase) ? button("End game", "end-game", {}, "quiet") : ""}</div></div></div>${s.phase !== "lobby" && s.phase !== "finished" ? phaseRibbon() : ""}<div class="layout"><div class="table-main">${controls()}${s.phase === "lobby" ? aiSetup() : ""}${s.phase !== "lobby" ? `<div class="boards">${track("Liberal", 5)}${track("Fascist", 6)}</div>${cardPiles()}` : `<div class="lobby-scene" aria-hidden="true"><div class="scene-caption"><span class="eyebrow">EVERYONE HAS A ROLE TO PLAY.</span><h3>Not everyone is<br>playing for you.</h3></div><div class="card-fan"><div class="fan-card fan-liberal">${icon("liberal")}<b>LIBERAL</b><small>FOR THE REPUBLIC</small></div><div class="fan-card fan-secret">${icon("seal")}<b>?</b><small>TRUST NO ONE</small></div><div class="fan-card fan-fascist">${icon("fascist")}<b>FASCIST</b><small>A HIDDEN AGENDA</small></div></div></div>`}${roster()}</div><aside class="table-sidebar">${identity()}${aiTableTalk()}<section class="panel record-panel"><div class="section-heading"><h3>The paper trail</h3><span class="record-dot"></span></div><div class="log">${
    s.log.length
      ? s.log
          .slice()
          .reverse()
          .map(
            (l, i) =>
              `<div class="log-entry"><span>${String(s.log.length - i).padStart(2, "0")}</span><p>${esc(l)}</p></div>`,
          )
          .join("")
      : "<p>No headlines. Yet.</p>"
  }</div></section><p class="small session-note">Your seat is saved on this browser.<br>Open a room’s invite to switch tables.</p></aside></div>`;
  $("#step-help")?.addEventListener("toggle", (event) => {
    localStorage.setItem(
      "assembly-guidance",
      event.currentTarget.open ? "open" : "closed",
    );
  });
  $("#secret")?.addEventListener("click", () => {
    showSecret = !showSecret;
    render();
  });
  $("#view-intelligence")?.addEventListener("click", showIntelligence);
  $("#chat-form")?.addEventListener("submit", sendChat);
  $("#chat-input")?.addEventListener("input", (e) => {
    chatDraft = e.target.value;
  });
  if (chatFocused && $("#chat-input") && !$("#chat-input").disabled) {
    $("#chat-input").focus({ preventScroll: true });
    $("#chat-input").setSelectionRange(...chatSelection);
  }
  $("#add-ai")?.addEventListener("click", () => manageBots("add"));
  $("#ai-comments")?.addEventListener("change", (e) =>
    manageBots("comments", { enabled: e.target.checked }),
  );
  app
    .querySelectorAll("[data-remove-ai]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          manageBots("remove", { target: button.dataset.removeAi })),
    );
  app.querySelectorAll("[data-recover]").forEach((button) => {
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await api(`/api/rooms/${s.code}/recovery`, {
          target: button.dataset.recover,
        });
        $("#recovery-title").textContent = `Recover ${r.name}’s seat`;
        $("#recovery-link").value =
          `${location.origin}/?room=${s.code}#recover=${r.key}`;
        $("#copy-recovery").textContent = "Copy private link";
        $("#seat-recovery").showModal();
        $("#recovery-link").focus();
        $("#recovery-link").select();
      } catch (e) {
        error(e);
      } finally {
        busy = false;
      }
    };
  });
  app.querySelectorAll("[data-kick]").forEach((button) => {
    button.onclick = async () => {
      if (busy) return;
      const target = s.players.find((p) => p.id === button.dataset.kick);
      if (
        !target ||
        !confirm(
          `Remove ${target.name} from this lobby? They can rejoin with the room link.`,
        )
      )
        return;
      busy = true;
      try {
        state = await api(`/api/rooms/${s.code}/kick`, { target: target.id });
        render();
      } catch (e) {
        error(e);
      } finally {
        busy = false;
      }
    };
  });
  $("#leave-room").onclick = leaveRoom;
  $("#new-table")?.addEventListener("click", leaveRoom);
  $("#invite").onclick = async () => {
    const link = `${location.origin}/?room=${s.code}`;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch {}
    if (!copied) {
      // HTTP pages lack the Clipboard API. Copy synchronously from a selection.
      const field = document.createElement("textarea");
      field.value = link;
      field.className = "clipboard-selection";
      field.readOnly = true;
      document.body.append(field);
      field.select();
      field.setSelectionRange(0, link.length);
      try {
        copied = document.execCommand("copy");
      } catch {}
      field.remove();
    }
    if (copied) {
      $("#invite").textContent = "Invite copied ✓";
      $("#invite").focus({ preventScroll: true });
    } else {
      const field = $("#invite-link");
      field.value = link;
      $("#share-invite").showModal();
      field.focus();
      field.select();
      field.setSelectionRange(0, link.length);
    }
  };
  app.querySelectorAll("[data-action]").forEach(
    (el) =>
      (el.onclick = async () => {
        if (busy) return;
        const type = el.dataset.action,
          payload = JSON.parse(el.dataset.payload);
        if (
          type === "end-game" &&
          !confirm(
            "End this game for everyone? Roles will be revealed, no winner will be declared, and you can start again in this room.",
          )
        )
          return;
        if (type === "select-discard" || type === "cancel-discard") {
          discardSelection =
            type === "select-discard"
              ? { key: discardKey(s), index: payload.index }
              : null;
          render();
          const target =
            type === "select-discard"
              ? '[data-action="discard"]'
              : '[data-action="select-discard"]';
          app.querySelector(target)?.focus({ preventScroll: true });
          return;
        }
        if (
          type === "power" &&
          s.power === "execute" &&
          !confirm(
            `Execute ${s.players.find((p) => p.id === payload.target).name}? This is permanent.`,
          )
        )
          return;
        busy = true;
        el.disabled = true;
        try {
          state = await api(`/api/rooms/${s.code}/action`, {
            type,
            payload,
            revision: s.revision,
            electionId: s.electionId,
          });
          $("#error").textContent = "";
          render();
          if (type === "power" && state.me.notes.length > s.me.notes.length)
            showIntelligence();
        } catch (e) {
          error(e);
          await poll();
        } finally {
          busy = false;
          el.disabled = false;
        }
      }),
  );
}
const pollGate = createPollGate();
async function poll() {
  const current = session;
  return pollGate({
    session: current,
    getSession: () => session,
    load: () => api(`/api/rooms/${current.code}`),
    onState: async (fresh) => {
      if (newerState(state, fresh)) {
        state = fresh;
        rememberSeat({
          ...current,
          name: fresh.players.find((p) => p.id === fresh.me.id).name,
        });
        render();
      }
      if ($("#connection")) $("#connection").textContent = "● CONNECTED";
    },
    onError: async (e) => {
      if ($("#connection")) $("#connection").textContent = "○ RECONNECTING";
      if (e.status === 401) {
        const seats = savedSeats();
        delete seats[current.code];
        localStorage.setItem("assembly-saved-seats", JSON.stringify(seats));
        if (readStored("assembly-session", null)?.code === current.code)
          localStorage.removeItem("assembly-session");
        const hadSeat = !!state;
        session = null;
        state = null;
        showSecret = false;
        chatDraft = "";
        $("#private-intelligence").close();
        $("#share-invite").close();
        $("#seat-recovery").close();
        landing();
        error(
          hadSeat
            ? "Your seat is no longer available. You may have been removed by the host."
            : e,
        );
      } else if (!state) {
        app.innerHTML = `<section class="panel"><h2>Reconnecting to your table…</h2><p class="small">Your seat is saved. We’ll retry automatically.</p><button class="quiet" id="retry-connection">Retry now</button></section>`;
        $("#retry-connection").onclick = poll;
      }
    },
  });
}

function setCompact(enabled) {
  document.body.classList.toggle("compact", enabled);
  $("#compact-toggle").setAttribute("aria-pressed", String(enabled));
  $("#compact-toggle").textContent = enabled ? "Compact ✓" : "Compact";
  localStorage.setItem("assembly-compact", JSON.stringify(enabled));
}
$("#copy-recovery").onclick = async () => {
  const field = $("#recovery-link");
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(field.value);
      copied = true;
    }
  } catch {}
  if (!copied) {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    try {
      copied = document.execCommand("copy");
    } catch {}
  }
  $("#copy-recovery").textContent = copied
    ? "Private link copied ✓"
    : "Select the link above and choose Copy";
};
$("#compact-toggle").onclick = () =>
  setCompact(!document.body.classList.contains("compact"));
setCompact(readStored("assembly-compact", false) === true);
$("#rules-toggle").onclick = () => $("#rules").showModal();
$("#rules-close").onclick = () => $("#rules").close();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) $("#private-intelligence").close();
  if (document.hidden && showSecret) {
    showSecret = false;
    if (state) render();
  }
});
// Recovery links carry the secret in the fragment, never in server access logs.
const recoveryKey = new URLSearchParams(location.hash.slice(1)).get("recover");
async function recoverSeat(key) {
  session = null;
  state = null;
  busy = true;
  try {
    const r = await api("/api/recover", { code: roomInURL(), key });
    session = { code: r.code, token: r.token };
    localStorage.setItem("assembly-session", JSON.stringify(session));
    rememberSeat({ ...session, name: r.name });
    history.replaceState(null, "", roomURL(r.code));
    await poll();
  } catch (e) {
    app.innerHTML = `<section class="panel"><h2>Unable to recover seat</h2><p>${esc(e.message)}</p><button id="retry-recovery">Retry</button></section>`;
    $("#retry-recovery").onclick = () => recoverSeat(key);
  } finally {
    busy = false;
  }
}
// Migrate old single-room sessions without letting them override an invite.
const legacySession = readStored("assembly-session", null);
if (legacySession?.code && legacySession?.token) rememberSeat(legacySession);
const requestedRoom = roomInURL();
session = requestedRoom ? (savedSeats()[requestedRoom] ?? null) : null;
if (recoveryKey) {
  session = null;
  app.innerHTML =
    '<section class="panel"><h2>Recover your seat</h2><p>Use this private link only if the host sent it to you for your own seat.</p><button id="accept-recovery">Resume my seat</button></section>';
  $("#accept-recovery").onclick = () => recoverSeat(recoveryKey);
} else if (session) poll();
else landing();
async function refreshLoop() {
  if (!busy) await poll();
  setTimeout(refreshLoop, state?.phase === "vote" ? 500 : 1000);
}
setTimeout(refreshLoop, 1000);

// Safari may restore a page from its back/forward cache with an expired seat.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
