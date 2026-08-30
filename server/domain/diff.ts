export interface DiffCounts {
  new: number
  persisting: number
  resolved: number
}

/** Set semantics over fingerprints: `new` = in current not previous;
 * `persisting` = in both; `resolved` = in previous not current. Counts are
 * of unique fingerprints, so duplicate entries in either iterable collapse. */
export function diffFingerprints(
  previous: Iterable<string>,
  current: Iterable<string>,
): DiffCounts {
  const previousSet = new Set(previous)
  const currentSet = new Set(current)

  let newCount = 0
  let persisting = 0
  for (const fingerprint of currentSet) {
    if (previousSet.has(fingerprint)) persisting++
    else newCount++
  }

  let resolved = 0
  for (const fingerprint of previousSet) {
    if (!currentSet.has(fingerprint)) resolved++
  }

  return { new: newCount, persisting, resolved }
}
