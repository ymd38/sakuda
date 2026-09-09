import type { EngineRunView } from '../types/api'

/** Warnings the engines emit when a run hit its time budget (see
 * server/engines/*): nuclei's per-phase and whole-run stops, and the
 * generic "timed out" runCommand outcome the ZAP runners surface. */
const LIMIT_WARNING_RE =
  /\b(timed out|timeout)\b|stopped after \d+ min|stopped by the engine timeout/i

/**
 * Whether a run ended because its time budget ran out rather than because
 * it finished. `meta.timedOut` is the engines' own verdict; the warning
 * scan covers nuclei's partial stops, which set a warning but keep the run
 * `done` with `timedOut` only when the whole budget was spent.
 */
export function isStoppedAtLimit(run: Pick<EngineRunView, 'meta' | 'warnings'>): boolean {
  if (run.meta.timedOut === true) return true
  return run.warnings.some((w) => LIMIT_WARNING_RE.test(w))
}
