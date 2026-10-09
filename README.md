# Party games

Three independently runnable multiplayer games in one Node.js repository:

| App | Players | Features |
| --- | --- | --- |
| Secret Hitler | 5–10 | Existing rules, private roles, optional AI seats and table talk |
| Coup | 2–6 | Claims, challenges, blocks, exchanges and private influence cards |
| Undercover | 3–12 | Related words, optional Mr. White, clue rounds, private votes, AI seats and chat |

## Run

Requires Node.js 22 or later. WebSocket support uses the `ws` package.

```sh
npm ci
npm test
npm run start:undercover
# Or choose an app and port:
GAME=secret-hitler PORT=3100 npm start
GAME=coup PORT=3101 npm start
GAME=undercover PORT=3102 npm start
```

Default `npm start` launches Undercover. Open the corresponding localhost port. Each player joins on a separate browser/device. Rooms and seats survive refresh; keep browser storage for recovery. Use a voice call or play together for discussion.

Each app defaults to its own `apps/<game>/data` directory. Set an absolute `DATA_DIR` in production. Never share a data directory between games or server instances. Room files contain private words, roles and bearer session tokens: keep them outside version control and private. Rooms expire after seven days of inactivity.

## Shared infrastructure

- `apps/`: game rules, authorized private views, UI, prompts and game-specific tests.
- `packages/core/`: atomic JSON storage, secure HTTP helpers, room codes, authentication, retry-safe joins, expiring seat recovery, revision-checked action copies, ballot collection/tally/identity checks, public chat storage/rate limits/reply selection, and browser transport/poll guards.
- `packages/core/room-server.js`: reusable room lifecycle server used by Undercover. Secret Hitler retains its AI/chat and election-specific adapter; Coup retains its established API and file format. All consume common helpers.
- `packages/ai/`: bounded JSON provider requests, timeouts, pricing caps, persistent spending reservations, and worker activity/concurrency gates. Games control their own prompts, legal moves and private context.

Game outcomes stay separate: Secret Hitler uses a strict yes/no majority; Undercover uses elimination totals and runoffs. Shared transport always sends a game-specific private view, never raw persisted room state. Existing app routes, storage schemas and browser storage keys remain compatible.

## AI

Set `OPENROUTER_API_KEY` in the server environment, never in browser assets or source files. `AI_MODEL` defaults to `z-ai/glm-5.3-flash`. Secret Hitler retains low reasoning; Undercover requests medium reasoning for gameplay and chat.

Each app has an independent ledger. `AI_DAILY_BUDGET_USD` defaults to $0.50 per UTC day, with limits of 120 paid requests per room and 1,000 per day. Reservations persist before requests; missing costs retain their reservation. Workers process two rooms concurrently, one request chain per room, pause after 60 seconds without a human poll or WebSocket heartbeat, and discard obsolete replies.

Undercover bots see only their word (or none), public clues, public discussion, and revealed roles. They generate clues freely; there is no predefined clue bank. One-word clues are checked for direct word disclosure and repetition; a separately budgeted model review assesses candidates. Bots discuss completed clue rounds and answer human messages, preferring named bots. They cannot hear external voice calls. Chat pauses during clue turns, ballots and Mr. White guesses; eliminated humans observe silently until the game ends. AI table talk can be toggled in the lobby.

Provider failure, invalid output or exhausted budgets produce labeled basic gameplay fallback; optional chat is skipped. AI clue quality and strategy are experimental. Small evaluation results in `apps/undercover/evals/` show remaining weaknesses and are not a benchmark or guarantee of good play.

## Deploy

Build the root Dockerfile with `--build-arg GAME=undercover` (or `coup` / `secret-hitler`). The container runs as UID 1000, listens on `PORT` (default 3000), and exposes `/health`. Mount a separate writable persistent directory at `/app/data`. Run one web process per data directory. File-backed deployments require stopping the old writer before starting its replacement and briefly interrupt service.

Example Dokku setup, substituting your own app, host and domain:

```sh
dokku apps:create YOUR_APP
dokku storage:ensure-directory --chown heroku YOUR_APP
dokku storage:mount YOUR_APP /var/lib/dokku/data/storage/YOUR_APP:/app/data
dokku ports:set YOUR_APP http:80:3000
dokku checks:disable YOUR_APP
dokku domains:set YOUR_APP game.example.com
dokku docker-options:add YOUR_APP build '--build-arg GAME=undercover'
dokku git:set YOUR_APP deploy-branch main
# Deploy this repository to your app's Git remote, then configure HTTPS.
```

For Secret Hitler, configure `nginx-conf-sigil-path` as `apps/secret-hitler/nginx.conf.sigil` and `appjson-path` as `apps/secret-hitler/app.json`. Its template supports legacy HTTP sessions; browser storage differs between HTTP and HTTPS. Other apps can use the platform's default Nginx template. Configure certificates and secrets using your host's administration tools. Back up private data before changing deployments.

## Validation

`npm test` runs shared infrastructure and all three game suites. Tests cover private views, complete game simulations, out-of-order replies, session changes during polling, duplicate joins, concurrent votes, stale ballots, action isolation, origins, proxy errors, seat recovery, persistence, AI privacy and budget handling, and chat permissions/stale replies.

Browser checks require a local installation of Playwright and Chromium. Set `PLAYWRIGHT_MODULE` to its module path if it is not resolvable as `playwright`; set `CHECK_URL` to a running test app:

```sh
CHECK_URL=http://localhost:3100 node apps/secret-hitler/browser-tests/invites.mjs
node apps/secret-hitler/browser-tests/recovery.mjs
CHECK_URL=http://localhost:3101 node apps/coup/browser-tests/smoke.mjs
CHECK_URL=http://localhost:3102 node apps/undercover/browser-tests/smoke.mjs
CHECK_URL=http://localhost:3102 node apps/undercover/browser-tests/bots.mjs
CHECK_URL=http://localhost:3102 node apps/undercover/browser-tests/chat.mjs
```

Browser tests create isolated test rooms. Bot/chat model checks require a configured provider; mocked unit tests do not. Evaluation scripts make paid requests only when explicitly run with a provider key.

## Attribution

See LICENSE and individual app documentation. Shared components extracted from the Secret Hitler adaptation retain its CC BY-NC-SA 4.0 license. Secret Hitler is by Mike Boxleiter, Tommy Maranges and Mac Schubert. Coup is designed by Rikki Tahta. Undercover is an original implementation of the related-word social deduction format with an original UI and a small hand-written word-pair list. No official game art is included.

Room updates use authenticated WebSockets shared by all three apps. Each connection receives only its seat-specific view. Actions remain revision-checked HTTP requests. Polling runs in parallel every 15 seconds while connected, returning to the normal 0.5–1.2 second cadence during outages. Reconnects use exponential backoff and receive a fresh snapshot; revision checks reject stale updates from either transport. Reverse proxies must forward WebSocket upgrade headers for `/api/live`.
