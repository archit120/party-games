> This app is now part of `/home/agent/party-games`. Run deployment commands from the repository root using its shared Dockerfile; see [the root README](../../README.md). Older standalone deployment instructions below are historical.

# Coup — The Court

Independent browser adaptation of the base Coup card game for 2–6 human players. Includes private room links, per-room seat recovery, server-enforced rules, challenges, blocks, card exchange, public action history and rematches. Discuss on a voice call or in person. No AI seats or built-in chat.

Run with Node 22+: `npm test`, then `npm start`. Default port: 3000. `DATA_DIR` defaults to `./data`. Room/session data is private and atomically persisted; rooms expire after seven days without an action. Run one process per data directory. Preserve browser storage to recover your seat. Players must explicitly respond; disconnected players pause progress until they return. Only lobby seats can leave.

Coup is designed by Rikki Tahta. This fan implementation uses original interface assets and no official artwork.

## Deployment

Dokku app `coup`, host `172.245.72.181`:
https://coup.172.245.72.181.sslip.io

Separate from the Secret Hitler project and app. Docker runs Node 22 as UID 1000, with a 128 MB memory limit. Persistent storage: `/var/lib/dokku/data/storage/coup:/app/data`. `/health` is the health endpoint. Zero-downtime deployment is disabled to avoid overlapping file-backed writers; deployments briefly interrupt the app.

```sh
dokku apps:create coup
dokku storage:ensure-directory --chown heroku coup
dokku storage:mount coup /var/lib/dokku/data/storage/coup:/app/data
dokku ports:set coup http:80:3000
dokku checks:disable coup
dokku domains:set coup coup.172.245.72.181.sslip.io
dokku resource:limit --memory 128m coup
git push dokku main
dokku letsencrypt:set coup email YOUR_EMAIL
dokku letsencrypt:enable coup
```

The `heroku` ownership option selects UID/GID 1000 on this Dokku version. Git remote: `dokku@172.245.72.181:coup`.

## Validation

`npm test` checks deck distribution, private views, resource costs, mandatory coups, challenge outcomes, blocking restrictions, double influence loss, exchanges, and 200 complete simulated games.

`CHECK_URL=http://127.0.0.1:3000 node browser-tests/smoke.mjs` checks separate browser sessions, invitations, private cards, actions, exchange, refresh recovery and mobile layout. The script uses the container's Playwright installation and Chromium and creates a test room.
