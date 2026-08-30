/** Formats the elapsed time since `startedAt` as `Xm YYs`. Scan duration
 * varies widely with target size, so the UI shows elapsed time rather than a
 * remaining-time estimate or progress percentage — it would otherwise create
 * a false expectation. Returns null (caller hides the row) when there is no
 * usable start time: unset, unparsable, or in the future. */
export function formatElapsed(startedAt: string | null | undefined, now: Date): string | null {
  if (!startedAt) return null

  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return null

  const totalSeconds = Math.floor((now.getTime() - start) / 1000)
  if (totalSeconds < 0) return null

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
