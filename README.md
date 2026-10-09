# Party games

One repository for three independently deployed multiplayer games:

| Game | URL | Players |
| --- | --- | --- |
| Secret Hitler | https://secret-hitler.172.245.72.181.sslip.io | 5–10, with existing optional AI seats |
| Coup | https://coup.172.245.72.181.sslip.io | 2–6 humans |
| Undercover | https://undercover.172.245.72.181.sslip.io | 3–12 humans |

## Work locally

Node.js 22 or newer. No third-party runtime dependencies.

```sh
npm test
npm run start:undercover
# Or select a game with the common launcher:
GAME=secret-hitler PORT=3100 npm start
GAME=coup PORT=3101 npm start
GAME=undercover PORT=3102 npm start
```

Default `npm start` launches Undercover. Each app uses its own `apps/<game>/data` locally. In production set an absolute `DATA_DIR`; never share one data directory between games or running processes.

## Layout and boundaries

- `apps/secret-hitler`: existing game rules, AI, chat, UI and regression suite.
- `apps/coup`: existing rules, UI, and regression suite. Original Coup Git history is retained.
- `apps/undercover`: related-word game with optional Mr. White, server-enforced clue turns, secret ballots, runoffs, elimination, guessing and rematches.
- `packages/core`: atomic private JSON storage, HTTP security and body limits, authentication, room codes, retry-safe joins, expiring seat recovery, and browser request/storage/escaping helpers. Shared joins/recovery and browser request behavior originate in Secret Hitler.
- `packages/core/room-server.js`: reusable room lifecycle server using Secret Hitler's endpoint and storage conventions, currently used by Undercover. Secret Hitler keeps its AI/chat and election-specific orchestration; Coup keeps its established API adapter.

Game rules and private views stay in their own apps. The shared package never serializes an entire room to clients. Refactoring preserves Secret Hitler's `rooms.json`, Coup's per-room JSON files, browser storage keys, routes, session tokens, and domains. Both existing games consume the common storage, HTTP, auth, and browser helpers. This is deliberately a gradual extraction, not a universal game engine.

Undercover shows each player only their word (or no word for Mr. White), with no team label for word-holders. Words and all remaining roles are revealed at game end. Ballots expose participation and final totals, not other players' choices. Impostors win at parity; civilians win after eliminating all impostors. Mr. White gets one exact, case-insensitive guess on elimination. One runoff is allowed; a second tie starts the next round without elimination. Host chooses 1–3 Undercover players plus optional Mr. White, with a required civilian majority. No AI seats or built-in voice chat in Undercover/Coup. Disconnected players must recover their seats to continue.

## Deploy from this repository

All apps use the root Dockerfile and the same commit, selected with a build argument. They remain separate Dokku apps on `172.245.72.181`, each limited to 128 MB with a separate `/app/data` mount. Do not deploy from the old standalone directories or the nested app directories.

```sh
# Per app, one-time setup (GAME is secret-hitler, coup, or undercover):
dokku docker-options:add GAME build '--build-arg GAME=GAME'
# Each remote targets its corresponding app; push from this repo:
git push dokku-secret-hitler main
git push dokku-coup main
git push dokku-undercover main
```

The example `GAME` placeholders must be replaced literally, e.g. `dokku docker-options:add coup build '--build-arg GAME=coup'`. Storage paths are `/var/lib/dokku/data/storage/<game>`. Create new directories with `dokku storage:ensure-directory --chown heroku GAME` (UID 1000). Use `http:80:3000`, one web instance, and disable zero-downtime checks to avoid concurrent file writers. Let’s Encrypt supplies HTTPS and auto-renewal. The Docker build preserves Secret Hitler's custom Nginx template and app healthchecks. Its existing HTTP access remains available for legacy browser sessions.

Updates briefly restart the selected app. Existing game state and sessions reload from their unchanged mounts. Before migration, backups were made inside the existing apps' data mounts. Keep backups private. To roll back, deploy the previous recorded Git commit/image with that app's previous Docker build options; data needs no format downgrade. The old source directories are retained as snapshots, not active development copies.

## Validation

`npm test` runs shared tests and all three apps' suites. Includes hundreds of full simulations, private-view isolation, role and action rules, concurrent ballots, stale action rejection, HTTP authentication, retry-safe joins, recovery and persistence.

Browser tests use the container's Playwright/Chromium installation:

```sh
PLAYWRIGHT_MODULE=/opt/browser-test/node_modules/playwright/index.mjs CHECK_URL=http://127.0.0.1:3100 node apps/secret-hitler/browser-tests/invites.mjs
PLAYWRIGHT_MODULE=/opt/browser-test/node_modules/playwright/index.mjs node apps/secret-hitler/browser-tests/recovery.mjs
CHECK_URL=http://127.0.0.1:3101 node apps/coup/browser-tests/smoke.mjs
CHECK_URL=http://127.0.0.1:3102 node apps/undercover/browser-tests/smoke.mjs
```

Browser smoke tests create disposable rooms; use local servers for routine runs. Undercover's smoke checks five isolated browsers, optional Mr. White, private reveal/hide, refresh recovery, clue turns, ballots, and mobile layout.

## Attribution

Shared components extracted from the existing Secret Hitler adaptation retain its CC BY-NC-SA 4.0 license; see LICENSE and the individual app documentation. Secret Hitler is by Mike Boxleiter, Tommy Maranges and Mac Schubert. Coup is designed by Rikki Tahta. Undercover is an original implementation of the related-word social deduction format with original UI and curated word pairs. No official game art is included.
