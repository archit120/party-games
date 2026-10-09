# Undercover AI quality checks

`quality.mjs` compares a saved baseline prompt with the current implementation on eight synthetic words and reconstructs two public voting rounds. It sends each model only its own word and public information. Run explicitly with `OPENROUTER_API_KEY`; it makes paid calls and writes `quality-results.json`. Model behavior is nondeterministic.

The latest 30-call sample reported approximately $0.00233. Seven of eight clues passed the model quality check; one used basic fallback. Examples changed from `reflection` to `smoke`, a full violin description to `rosin`, and `umbrella` to `petrichor`. Other outputs (`morning`, `silence`, `tide`) may still be too obvious. One-word output and lower verbosity are improvements, not proof of strategic quality.

The reconstructed first round remains ambiguous. Two revised majority-word bots voted for another bot, while the minority-word bot voted for the human. In round two, both majority-word bots selected the actual minority player from stronger public clues. These are small samples, not reliable win rates or deterministic replays of the original game. No hidden roles were supplied to the models.

`first-pass-results.json` records an earlier prompt that still produced overly identifying clues and did not resolve the voting concern. No predefined word-specific clue bank or extra-round rule was added. Real gameplay remains experimental, and AI discussion can be mistaken.
