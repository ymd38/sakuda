import { headersConfigArgs } from '../../headersConfig'

export interface HttpxArgsInput {
  /** One target URL per line — the exact list nuclei is about to receive. */
  targetsFile: string
  /** `-threads`: the same parallelism nuclei runs with. */
  threads: number
  /** `-rl`: the site's request-rate cap (req/s), shared with nuclei. */
  rateLimit: number
  /** Path of the 0600 headers config shared with the nuclei phases, or null
   * when the site has no headers — the values never go on argv (#95). */
  headersConfigFile: string | null
}

/** Per-request timeout (`-timeout`, seconds). The run as a whole is bounded by
 * `runCommand`'s timeout above it. */
export const HTTPX_REQUEST_TIMEOUT_SEC = 10

/**
 * A liveness probe, nothing more: one GET per target, no redirect following
 * (`-fr` is never passed — the target's own status is what we record), the
 * input scheme kept (`-nfs`; note `-nf` is *not* its sibling: it makes httpx
 * probe both schemes), and `-probe` so a failed target is still reported as
 * one JSONL line (`failed: true`) instead of being silently omitted. `-retries
 * 0` because an uncertain target is kept anyway. No `-kb`: httpx ≥ 1.12 runs
 * its page-type classifier (and downloads its model) only when asked.
 *
 * No `-o`: httpx prints the JSONL to stdout either way, and `runCommand`
 * captures stdout to a file, so that capture *is* the artifact.
 *
 * Verified against httpx 1.10.0 / 1.12.0 (2026-09-10): with `-nfs -probe`
 * every input line yields exactly one output line whose `input` field is the
 * line verbatim.
 */
export function buildHttpxArgs(i: HttpxArgsInput): string[] {
  return [
    '-l',
    i.targetsFile,
    '-json',
    '-silent',
    '-nc',
    '-nfs',
    '-probe',
    '-duc',
    '-retries',
    '0',
    '-timeout',
    String(HTTPX_REQUEST_TIMEOUT_SEC),
    '-threads',
    String(i.threads),
    '-rl',
    String(i.rateLimit),
    ...headersConfigArgs(i.headersConfigFile),
  ]
}
