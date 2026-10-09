// Validate before cloning. Failed game actions mutate only a disposable copy.
export function beginAction(
  room,
  { revision, revisionKey = "revision", concurrent = false } = {},
) {
  if (!concurrent && revision !== room[revisionKey]) {
    const error = Error("The table changed. Please try again.");
    error.status = 409;
    throw error;
  }
  return structuredClone(room);
}
