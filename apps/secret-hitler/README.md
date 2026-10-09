# Secret Hitler — The Assembly

Independent, noncommercial browser adaptation for 5–10 players, with up to four optional AI seats. Each player uses a separate browser/device. Discuss together or on an external voice call.

Run `npm run start:secret-hitler` from the repository root. See the [root README](../../README.md) for shared infrastructure, configuration, deployment and tests.

## Gameplay and rooms

Implements the original role counts, 6 Liberal / 11 Fascist policy deck, 5–6-player Hitler knowledge exception, strict-majority voting, term limits, chaos, executive-power boards, party-only investigations, special elections, executions, vetoes and victory conditions. Each player's view contains only authorized private information.

Create a room and share its invitation link. The browser keeps a separate seat per room. Join retries avoid duplicate seats; the host can remove lobby seats or issue an expiring private recovery link. Leaving a lobby frees the seat and transfers hosting to the next human. Leaving an active game preserves the seat. The host may end a stuck game and restart while keeping the room's seats.

Rooms use atomically saved `rooms.json` state. Keep the data directory private and persistent. Run one writer per data directory. Public ballots accept simultaneous responses within the same election and preserve legacy revision-only clients. Private intelligence and discard-confirmation controls remain game-specific.

## AI and chat

Set provider credentials in the server environment. Bots receive their own role, known allies, private cards/intelligence, their observed hands, and public history. They do not receive other players' secrets or hear external voice chat. Legal choices and model output are validated by the server. Provider errors or budget limits use a limited-information fallback.

Public table talk combines human messages, bot replies and policy reactions. Messages are capped at 400 characters with per-seat cooldowns and rate limits. Chat pauses during private legislation; executed players observe until game end. AI comments can bluff and can be wrong. A separate public-only review suppresses unsupported disclosures and contradictions without cancelling legal game moves. Requests, reservations and activity limits use the shared AI package.

## Validation

`npm test --workspace=secret-hitler-online` runs engine, AI, chat and HTTP tests, including full simulations and private-view checks. Browser regressions cover invitations, seat recovery, duplicate joins, host removal, discard confirmation, end-game and restart flows.

Rules source: https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf

Secret Hitler was created by Mike Boxleiter, Tommy Maranges and Mac Schubert: https://www.secrethitler.com/ . This adaptation uses an original interface and no original game artwork. Licensed under Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International; see LICENSE.
