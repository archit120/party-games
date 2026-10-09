> This app is now part of `/home/agent/party-games`. Run deployment commands from the repository root using its shared Dockerfile; see [the root README](../../README.md). Older standalone deployment instructions below are historical.

# Secret Hitler — The Assembly

An independent, noncommercial browser adaptation for 5–10 players, with up to four optional AI seats. Each player uses a separate browser/device and discusses the game in person or on a voice call. Voice chat is external.

## Run

Node.js 22 or newer; no third-party runtime dependencies.

```sh
npm test
npm start
```

Open http://localhost:3000. Create a room and share its invitation link. Players retain their seat across reloads in the same browser. Keep browser storage intact; there is no account-based recovery. Use **Leave room** beside the invite button to switch rooms. Leaving a lobby frees the seat and transfers hosting to the next player when necessary. Leaving a running game saves a **Resume** button on the entrance screen; that seat remains in play. An absent player pauses the game until they return. Start a new room if a player permanently leaves.

`PORT` defaults to `3000`. `DATA_DIR` defaults to `./data`. Room state is atomically saved after each action and expires after seven days of inactivity. Run exactly one server instance per data directory. Private roles and session tokens are stored in this directory; keep it private and persist it across deploys.

## Dokku deployment

A Dockerfile is included. Run these commands on your Dokku host (substitute your own domain):

```sh
dokku apps:create secret-hitler
dokku storage:ensure-directory secret-hitler
dokku storage:mount secret-hitler /var/lib/dokku/data/storage/secret-hitler:/app/data
dokku ports:set secret-hitler http:80:3000
dokku checks:disable secret-hitler
dokku domains:set secret-hitler game.example.com
```

The image runs as UID 1000 (`node`); ensure the storage directory is writable by UID 1000. Deploy with a Git push to `dokku@YOUR_HOST:secret-hitler`. Point DNS at the host, then enable HTTPS using your host's existing certificate setup or Dokku's letsencrypt plugin. Use one web process. Disable zero-downtime deployment for this file-backed implementation so old and new processes never concurrently write room state; updates briefly interrupt service. `/health` is the health endpoint. Forwarded client IPs are not trusted; public ingress creation/join rate limiting is shared if all traffic arrives through one proxy IP.

## Rules and validation

Sources reviewed:

- https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf
- https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf

Implements the original role counts, 6 Liberal / 11 Fascist policy deck, 5–6 player Hitler knowledge exception, strict majority ballots, living-player term limits, chaos, all three executive-power boards, party-only investigations, special-election rotation, executions, vetoes, and all four victory conditions. Dead players retain their private view and observe; they must remain silent on the external voice call.

The server validates identity, turn, phase, payload, and revision. Clients receive only their authorized private information. Unit tests include 200 complete simulated games and edge cases. Browser checks cover creating/joining a five-player room, starting, role reveal/hide, desktop/mobile layout, and JavaScript errors.

## Attribution and license

Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert: https://www.secrethitler.com/ . This adaptation adds an original web interface, room/session management, and automated rule enforcement. No original game artwork is bundled.

This adaptation is licensed under Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International: https://creativecommons.org/licenses/by-nc-sa/4.0/ .

## Current deployment

Deployed on `racknerd-331537d` (`172.245.72.181`) as Dokku app `secret-hitler`.

URL: https://secret-hitler.172.245.72.181.sslip.io

Persistent storage: `/var/lib/dokku/data/storage/secret-hitler` mounted at `/app/data`. The web process has a 128 MB memory limit. HTTPS is enabled with Let’s Encrypt. HTTP remains available to preserve existing browser sessions, since localStorage is separate for each protocol. The custom `nginx.conf.sigil` is based on Dokku 0.35.20’s default template with the HTTP-to-HTTPS redirect removed. HSTS is disabled for this app. The host’s default `apps.archit.me` DNS currently points to a different server.

## Guided table interface

The table includes illustrated policy cards, face-down draw/discard stacks, player seats, and an election tracker. Expand the help beneath an action to learn the current phase; the browser remembers whether to keep this help open. Starting deck counts are public (6 Liberal, 11 Fascist). Remaining unplayed totals span all hidden piles and hands; the exact draw-pile composition is intentionally secret.

Voting shows who has not yet voted without revealing ballot choices. Ballots are independently accepted within the same election, including simultaneous requests, and duplicate submissions do not change a sealed vote. Older open tabs are supported using revisions scoped to the current voting phase. HTML proxy errors are converted into readable retry messages, and reconnection preserves the room session.

Policy Peek and investigations open a private result dialog immediately. The player can reopen saved results with **View private intelligence**, independently of revealing their role. Peek cards show their original top-first order and are labeled as a historical snapshot.

## Optional AI seats

The host can add or remove up to four AI players in the lobby and toggle short public comments. One human plus four bots can play. AI players cannot hear voice chat. Each receives only its own role, known allies, private cards and intelligence, past observed hands, and public game history. Comments are in-character claims and can be bluffs, not private reasoning. Legislative actions stay silent; voting comments wait until a safe public phase.

Set `OPENROUTER_API_KEY` on the server, never in browser assets. `AI_MODEL` defaults to `z-ai/glm-5.3-flash`, using low reasoning effort and automatic provider routing. Research on 2026-10-08: OpenRouter lists $0.15 per million input tokens and $0.50 per million output tokens; routes may vary. Sources: https://openrouter.ai/z-ai/glm-5.3-flash and https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints . Small sequential policy probes passed 3/3 at roughly 0.4–1.2 seconds; these are sanity checks, not a strategic benchmark.

The server enumerates legal moves and validates model output before applying a normal game action. Calls time out after 12 seconds and use a basic limited-information strategy on API errors, malformed output or exhausted budget. The roster labels basic fallback decisions. At most two rooms call the provider concurrently, with one outstanding decision per room. Bots pause when no human has polled the room for 60 seconds. Stale responses are discarded.

`AI_DAILY_BUDGET_USD` defaults to 0.50 across the server. The persistent `ai-budget.json` ledger reserves $0.01 before each request and reconciles reported cost; unknown costs keep the full reservation. There are also limits of 120 paid decisions per room and 1,000 per UTC day. After a limit, bots continue with the basic strategy. Model context and output are capped and provider routing has price ceilings. AI gameplay is experimental and cannot interpret human voice discussions.

## Room URLs and invitation forms

The `?room=ABCDEF` URL selects the room. Browser seats are saved separately per room; existing single-room sessions are migrated. The homepage shows saved seats instead of automatically opening the last room. Opening another invite preserves existing seats and shows resume controls. Refreshing an invite resumes only its matching seat; separate tabs may use different rooms.

Invite pages present a single Join action, including keyboard Enter/Go. Homepage submissions with a room code also join; an empty code creates a room. Joining and creating navigate to the resulting room URL. Invalid, unavailable or expired invites never fall back to creating a room. Expired authentication retains the intended invite so the player can rejoin. Leaving a lobby removes that seat; leaving an active game preserves it.

Browser regressions: with a test server running, execute `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node browser-tests/invites.mjs`. `CHECK_URL` defaults to `http://127.0.0.1:3000`. The check uses Chromium at `/usr/bin/chromium`, creates temporary lobby seats, and removes them afterward. It covers both invite bugs, Enter/button submission, per-room recovery, separate tabs, history navigation, invalid invites, and mobile layout. This is Chromium mobile emulation, not physical iOS testing.

AI table talk also reacts to each newly revealed policy. The AI government members speak (up to two); if there are none, one living AI observer reacts. Chaos policies are explicitly identified as random top-deck enactments. Reactions use only the speaker's permitted view and its own observed hands, and are labeled with the policy number. Private phases and voting suppress publication; stale reactions and dead speakers are discarded. Reactions use the existing comments toggle, provider timeout, concurrency and spending limits. Provider failure or budget exhaustion skips optional reactions. Public comments are prompted to use a claimed Liberal perspective regardless of secret allegiance; bots can bluff about their own hands, but must not describe a Fascist policy as evidence of trustworthiness. These are model-generated claims, not guaranteed truthful statements.

## In-game public chat

Table talk combines player messages, AI opinions and policy reactions. Messages persist in the room and are visible to all its players. Humans may send up to 400 characters per message, with a two-second cooldown and 15-message-per-minute limit per seat. Chat is disabled server-side during private legislation/veto; executed players can read but cannot send until the game ends. Draft text and input focus survive polling updates.

When AI table talk is enabled, one living bot may reply to the latest human message, preferring a bot mentioned by name. Replies are debounced, have a ten-second room cooldown, expire after a minute, and do not trigger other AI replies. Bots receive recent public chat as untrusted game claims along with their usual private seat information. AI replies wait for a public phase and share the existing model request/budget limits; provider failures or budget exhaustion skip optional replies. The 120-request room limit now covers actions, policy reactions and chat replies.

AI context now retains the bot's own published statements separately from recent table chat, preserving policy/election identifiers. Observed hands explicitly distinguish discarded, passed, and enacted cards and whether the hand was forced. Existing published messages seed that history. A separate, budgeted public-comment check sees public context and previous claims, but no secret role or private cards. It rejects incoherent confessions and contradictions; failed checks, provider errors, or unavailable budget suppress the comment without invalidating the game action. It is still model-based judgment, not a guarantee of strategic quality. Long comments now end at a sentence boundary where possible instead of mid-word.

The roster shows public starting role totals (Liberals, regular Fascists, and Hitler separately), unchanged by executions. Compact view can be toggled in the header and is remembered on each browser.

## Play again

After the game ends, the host can choose **Play again** to return the same room and seats (including bots) to the lobby. The host can adjust the roster before dealing fresh roles. Roles, deaths, policies, private intelligence, game/chat history and AI memories are cleared; session tokens and the room link continue to work. In-flight AI results from the previous game are discarded. The 120-request allowance resets for the new game; the server-wide daily spending ledger does not.

The lobby host can kick another player using **Kick** beside their seat. The host confirms the name before removal. The server checks host identity and lobby phase, frees the seat, and invalidates the removed player's session. The removed browser returns to the invitation form instead of remaining stuck on Reconnecting. This removes a seat; it is not a ban, so the player can rejoin using the link. In-progress games retain their seats.

Join attempts now carry a random per-attempt recovery key kept in that browser until the seat is saved. Retrying after a lost response resumes the same seat, even if the room filled or started meanwhile, rather than creating an orphaned seat. Names alone never grant access to an existing seat. Existing ghosts without a recoverable browser session can be removed by the lobby host.

AI chat can now select up to two living bots for a human message: those explicitly named or involved in the policy/government being questioned. Generic chat still selects one; asking both/everyone can select two. Selection is frozen when the human message arrives, each bot gets at most one attempt, and the second sees the first reply and is asked to skip repetition. AI messages never trigger additional replies. Both replies share the same budget and public-comment checks.
