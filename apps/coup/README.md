# Coup — The Court

Browser adaptation of the base Coup card game for 2–6 human players. Includes private room links, per-room seat recovery after refresh, server-enforced claims and challenges, blocks, influence loss, exchanges, public action history and rematches. Discuss on a voice call or in person. No AI seats or built-in chat.

Run `npm run start:coup` from the repository root. See the [root README](../../README.md) for shared infrastructure, deployment and tests. Coup retains its existing per-room JSON storage format and browser storage keys. Only lobby seats may leave; disconnected players must return to continue an active game.

`npm test --workspace=coup-table` checks deck distributions, costs, mandatory coups, challenges, blocking restrictions, double influence loss, exchanges, private views, 200 simulated games and HTTP persistence. The browser smoke covers invitations, separate browser sessions, private cards, actions, exchanges, refresh and mobile layout.

Coup is designed by Rikki Tahta. This fan implementation uses original interface assets and no official artwork.
