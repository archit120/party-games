# Party games

- Work from the repository root. Applications are npm workspaces under `apps/`.
- Run `npm test` for shared/core or AI infrastructure changes; retain game-specific private-view and browser regressions.
- Preserve app routes, browser storage keys and saved-room schemas unless an explicit migration is tested.
- Keep secret-state filtering in each game's view function. Never return raw rooms directly.
- Build the root Dockerfile with the appropriate GAME argument. Keep production data, provider credentials and host-specific configuration outside Git.
- Follow the runtime's browser instructions and prefer its collaborative preview tools when available.
