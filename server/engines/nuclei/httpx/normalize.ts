/**
 * What one httpx JSONL line tells us about one target line: the input URL
 * verbatim (`input` — never `url`, which httpx may rewrite), the status it
 * observed, and whether the request failed at the transport level. Only these
 * fields are read; titles, tech fingerprints and IPs stay in the artifact.
 */
export interface HttpxObservation {
  input: string
  /** The observed status; `null` when httpx reported none (a failed probe
   * writes `status_code: 0`, which is normalized to `null`). */
  statusCode: number | null
  failed: boolean
  error: string | null
}

export interface ParsedHttpxJsonl {
  observations: HttpxObservation[]
  invalidLines: number
}

function asObservation(v: unknown): HttpxObservation | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.input !== 'string' || o.input.length === 0) return null
  const status =
    typeof o.status_code === 'number' && Number.isInteger(o.status_code) && o.status_code > 0
      ? o.status_code
      : null
  return {
    input: o.input,
    statusCode: status,
    failed: o.failed === true,
    error: typeof o.error === 'string' && o.error.length > 0 ? o.error : null,
  }
}

/** Parses httpx `-json` output; a line that is not JSON or lacks `input` is
 * counted, not thrown, so one odd line never discards the rest. */
export function parseHttpxJsonl(text: string): ParsedHttpxJsonl {
  const observations: HttpxObservation[] = []
  let invalidLines = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      invalidLines++
      continue
    }
    const obs = asObservation(parsed)
    if (obs) observations.push(obs)
    else invalidLines++
  }
  return { observations, invalidLines }
}

/**
 * Statuses that never justify dropping a target, whatever the prune list
 * says: 405 (the method is refused, the path exists), 429 (we were
 * throttled) and every 5xx (the server, not the path, is in trouble) tell us
 * nothing about whether nuclei's own requests would reach something.
 */
export function isPrunableStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 405 && status !== 429
}

export interface TargetAnnotation {
  /** The targets nuclei receives, in input order. */
  kept: string[]
  /** Targets removed because httpx observed a status on the prune list. */
  dropped: string[]
  /** Inputs httpx wrote a line for (failed or not). */
  observedCount: number
  /** Inputs with no line at all — kept, as "unknown". */
  unobservedCount: number
  /** Inputs httpx marked `failed` (transport error) — kept, as "unknown". */
  failedCount: number
  /** Observed status → how many inputs got it. */
  statusCounts: Record<string, number>
}

/**
 * The one decision this probe makes, as a pure function: which of the
 * `inputs` nuclei still gets. The default answer is *all of them* —
 * `pruneStatusCodes` is empty unless the operator opted in — and even then a
 * target is dropped only on positive evidence: httpx wrote a line for it, the
 * request did not fail, and the status is both on the list and prunable
 * (see `isPrunableStatus`). No line, a failed line, a 405/429/5xx: unknown,
 * keep. Codex's review of the original "drop 404/410" plan is why the default
 * is annotate-only — error pages can carry XSS, auth can hide a resource, and
 * nuclei templates request paths of their own (#91).
 */
export function annotateTargets(
  inputs: string[],
  observations: HttpxObservation[],
  pruneStatusCodes: number[],
): TargetAnnotation {
  const byInput = new Map<string, HttpxObservation>()
  for (const o of observations) if (!byInput.has(o.input)) byInput.set(o.input, o)
  const prune = new Set(pruneStatusCodes.filter(isPrunableStatus))

  const kept: string[] = []
  const dropped: string[] = []
  const statusCounts: Record<string, number> = {}
  let observedCount = 0
  let unobservedCount = 0
  let failedCount = 0
  for (const input of inputs) {
    const o = byInput.get(input)
    if (!o) {
      unobservedCount++
      kept.push(input)
      continue
    }
    observedCount++
    if (o.failed || o.statusCode === null) {
      failedCount++
      kept.push(input)
      continue
    }
    statusCounts[String(o.statusCode)] = (statusCounts[String(o.statusCode)] ?? 0) + 1
    if (prune.has(o.statusCode)) dropped.push(input)
    else kept.push(input)
  }
  return { kept, dropped, observedCount, unobservedCount, failedCount, statusCounts }
}
