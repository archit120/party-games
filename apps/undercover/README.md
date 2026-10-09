# Undercover — Between the Lines

3–12 players on separate devices. Create a room, invite friends, choose 1–3 Undercover players and optional Mr. White. Civilians must outnumber all impostors at the start (Mr. White therefore requires at least 5 players with one Undercover).

Players privately reveal their words, take turns entering short clues, discuss, and cast private elimination votes. One tie triggers a runoff; a second tie starts another clue round. Civilians win when every impostor is eliminated; impostors win at parity. Eliminated Mr. White gets one exact case-insensitive guess at the civilian word. Host can restart after a win. Every character's word stays private until the game ends.

Room links and seats survive refresh. The host can issue 15-minute private recovery links, remove lobby players, and transfer hosting by leaving the lobby. Keep recovery links private. The host can add up to four AI players. They receive only their own word and public clues, and use the shared AI provider/budget/scheduler layer. Failed or budget-limited requests use clearly labeled basic fallback. No timers or voice chat are included. A missing player must return or recover their seat to continue.

Run `npm run start:undercover` from the repo root. See [deployment and tests](../../README.md).

Public chat is available in the lobby, discussion and after the game. AI players volunteer observations and answer human messages, with shared cooldowns, spending limits and stale-response checks. The host can toggle AI table talk in the lobby. Chat pauses during clue turns, votes and the Mr. White guess. Clues are model-generated; no predefined clue bank or extra-round rule is used. See the evaluation artifacts for limitations.
