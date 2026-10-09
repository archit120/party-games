// Pure ballot mechanics. Games retain their winner, majority, and tie rules.
export const hasVoted = (votes, id) => Object.hasOwn(votes || {}, id);
export function castBallot({ votes, voterId, value, voters, choices }) {
  if (!voters.includes(voterId)) throw Error("You are not eligible to vote.");
  if (!choices.includes(value))
    throw Error("Choose an eligible ballot option.");
  if (hasVoted(votes, voterId)) throw Error("Your vote is already sealed.");
  votes[voterId] = value;
  return voters.every((id) => hasVoted(votes, id));
}
export function tallyBallots(votes, choices) {
  const counts = new Map(choices.map((value) => [value, 0]));
  for (const value of Object.values(votes)) {
    if (!counts.has(value)) throw Error("Invalid stored ballot option.");
    counts.set(value, counts.get(value) + 1);
  }
  return counts;
}
// Parallel votes may share a revision but must belong to the same ballot.
// Only Secret Hitler opts into the legacy revision-only client contract.
export function sameBallot({
  submittedId,
  currentId,
  submittedRevision,
  currentRevision,
  firstRevision,
  allowLegacy = false,
}) {
  if (submittedId !== undefined) return submittedId === currentId;
  return (
    allowLegacy &&
    Number.isInteger(submittedRevision) &&
    Number.isInteger(firstRevision) &&
    submittedRevision >= firstRevision &&
    submittedRevision <= currentRevision
  );
}
