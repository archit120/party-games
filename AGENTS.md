# Party games

Run commands from this repository, not the old standalone snapshots at `/home/agent/word-guess` or `/home/agent/coup`.

- Run `npm test` for shared/core or deployment changes; game-specific scripts are npm workspaces.
- Preserve each existing app's public routes, browser storage keys and saved-room schema unless an explicit migration is tested.
- Keep secret-state filtering in each game's view function. Never return persisted rooms directly.
- Use the root Dockerfile with the appropriate GAME build argument. Production data remains in separate persistent mounts; never check it into Git.
- For browser work, follow `/home/agent/BROWSER.md` and the runtime's preferred preview tools.
