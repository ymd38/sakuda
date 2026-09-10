import { headersToHeaderArgs } from '../../../domain/headerCipher'
import type { Header } from '#shared/schemas/headers'

export interface HttpxArgsInput {
  /** One target URL per line — the exact list nuclei is about to receive. */
  targetsFile: string
  /** `-threads`: the same parallelism nuclei runs with. */
  threads: number
  /** `-rl`: the site's request-rate cap (req/s), shared with nuclei. */
  rateLimit: number
  headers: Header[]
}

/** Per-request timeout (`-timeout`, seconds). The run as a whole is bounded by
 * `runCommand`'s timeout above it. */
export const HTTPX_REQUEST_TIMEOUT_SEC = 10

/** Placeholder for a header value in the persisted argv (`args.json`). */
export const REDACTED_HEADER_VALUE = '***'

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
    ...headersToHeaderArgs(i.headers),
  ]
}

/** The argv with every `-H` value replaced by `<name>: ***`, for the
 * `args.json` artifact — the site's auth headers must never land on disk in
 * the clear. Pure: the input array is not modified. */
export function redactHttpxArgs(args: string[]): string[] {
  const out = [...args]
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k] !== '-H') continue
    const value = out[k + 1]!
    const colon = value.indexOf(':')
    const name = colon === -1 ? value : value.slice(0, colon)
    out[k + 1] = `${name}: ${REDACTED_HEADER_VALUE}`
    k++
  }
  return out
}
