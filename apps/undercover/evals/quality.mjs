import { readFileSync, writeFileSync } from "node:fs";
import { completeJSON } from "../../../packages/ai/provider.js";
import { chooseWithModel, decisionContext, basicDecision } from "../ai.js";
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw Error("Set OPENROUTER_API_KEY");
const baselineSystem = readFileSync(
  new URL("./baseline-prompt.txt", import.meta.url),
  "utf8",
);
let cost = 0,
  calls = 0;
const reserveReview = () => {
  calls++;
  if (cost > 0.05) throw Error("Evaluation cost cap reached");
  return {
    finish(n) {
      cost += typeof n === "number" ? n : 0.01;
    },
  };
};
const players = [
  { id: "ada", name: "Ada", alive: true },
  { id: "basil", name: "Basil", alive: true },
  { id: "cora", name: "Cora", alive: true },
  { id: "human", name: "Human", alive: true },
];
function fixture(word) {
  return {
    gameId: "evaluation",
    round: 1,
    phase: "clue",
    voteId: 1,
    turn: "ada",
    me: { id: "ada", word, wordless: false, alive: true },
    players,
    clues: [],
    log: [],
    chatMessages: [],
    candidates: [],
    myVote: null,
  };
}
const results = [];
for (const word of [
  "mirror",
  "window",
  "coffee",
  "beach",
  "violin",
  "library",
  "rain",
  "cake",
]) {
  if (cost > 0.05) break;
  const v = fixture(word);
  let baseline,
    improved,
    source = "model";
  try {
    calls++;
    const r = await completeJSON({
      apiKey,
      system: baselineSystem,
      context: decisionContext(v),
      title: "Undercover quality check - baseline",
    });
    cost += r.cost ?? 0.01;
    baseline = r.parsed.text;
  } catch (e) {
    baseline = "ERROR: " + e.message;
  }
  try {
    calls++;
    const r = await chooseWithModel(v, { apiKey, reserveReview });
    cost += r.cost ?? 0.01;
    improved = r.choice.payload.text;
  } catch (e) {
    improved = basicDecision(v).choice.payload.text;
    source = "basic (" + e.message + ")";
  }
  results.push({ word, baseline, improved, source });
  console.log(JSON.stringify(results.at(-1)));
}
const clues1 = [
  { id: "cora", text: "glass", round: 1 },
  { id: "basil", text: "reflection", round: 1 },
  { id: "human", text: "Silver", round: 1 },
  { id: "ada", text: "bathroom wall", round: 1 },
];
const clues2 = [
  { id: "basil", text: "vanity", round: 2 },
  { id: "cora", text: "curtains", round: 2 },
  { id: "ada", text: "smoke", round: 2 },
];
const votes = [];
for (const round of [1, 2])
  for (const [id, word] of [
    ["ada", "mirror"],
    ["basil", "mirror"],
    ["cora", "window"],
  ]) {
    const v = {
      ...fixture(word),
      phase: "vote",
      round,
      turn: null,
      me: { id, word, wordless: false, alive: true },
      players: players.map((p) =>
        p.id === "human" && round === 2
          ? { ...p, alive: false, role: "civilian" }
          : p,
      ),
      clues: round === 1 ? clues1 : [...clues1, ...clues2],
      candidates: players
        .filter((p) => round === 1 || p.id !== "human")
        .map((p) => p.id),
      log: round === 2 ? ["Human was eliminated: Civilian."] : [],
    };
    calls++;
    try {
      const r = await chooseWithModel(v, { apiKey });
      cost += r.cost ?? 0.01;
      votes.push({ round, bot: id, vote: r.choice.payload.target });
    } catch (e) {
      votes.push({ round, bot: id, error: e.message });
    }
  }
const report = {
  date: new Date().toISOString(),
  model: "z-ai/glm-5.3-flash",
  calls,
  reportedOrReservedCost: cost,
  clues: results,
  votes,
  limitations:
    "Small prompt sanity check, not a strategic benchmark. Round-one clues are ambiguous; actual hidden roles were not given to the models. The transcript is a reconstructed public fixture, not a replay of original model requests.",
};
writeFileSync(
  new URL("./quality-results.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ calls, cost, votes }));
