import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '../../../lib/logger'
import { runCommand, SpawnError } from '../../runCommand'
import { writeSecretFile } from '../../secretFile'
import { EngineError } from '../../types'
import { buildHttpxArgs } from './args'
import { annotateTargets, parseHttpxJsonl } from './normalize'

/** Sub-directory of nuclei's work dir: `data/scans/<scanId>/nuclei/httpx/`. */
export const HTTPX_WORK_SUBDIR = 'httpx'

export interface HttpxProbeInput {
  scanId: string
  /** The exact lines nuclei is about to read (seeded, host alias applied). */
  targetUrls: string[]
  /** nuclei's work dir; the probe writes under `httpx/` inside it. */
  workDir: string
  bin: string
  /** Hard cap for the whole probe; taken out of the nuclei run's budget. */
  timeoutMs: number
  threads: number
  rateLimit: number
  /** The nuclei run's 0600 headers config (shared with its phases), or null. */
  headersConfigFile: string | null
  /** Statuses that drop a target — empty by default (annotate only). */
  pruneStatusCodes: number[]
  signal: AbortSignal
  logger: Logger
}

/** `ok` = ran to a clean exit (the only state in which pruning applies);
 * `unavailable` = binary missing; `failed` = non-zero exit; `timedOut` =
 * cut by the cap. In every state but `ok`, every target passes through. */
export type HttpxProbeStatus = 'ok' | 'unavailable' | 'failed' | 'timedOut'

export interface HttpxProbeMeta {
  status: HttpxProbeStatus
  inputCount: number
  observedCount: number
  unobservedCount: number
  failedCount: number
  keptCount: number
  droppedCount: number
  /** Same disclosure level as nuclei's `meta.excludedUrls`. */
  droppedUrls: string[]
  statusCounts: Record<string, number>
  pruneStatusCodes: number[]
  durationSec: number
  exitCode: number | null
}

export interface HttpxProbeResult {
  /** What nuclei gets, in input order. */
  kept: string[]
  meta: HttpxProbeMeta
  warnings: string[]
}

/**
 * Probes the GET target list once with httpx and decides what nuclei still
 * receives (see `annotateTargets` for the rule — by default, everything).
 * Never throws for httpx's own trouble: a missing binary, a failed run or
 * the cap all degrade to "pass every target through, and say so", because
 * an unprobed target list is exactly what nuclei scanned before #91. An
 * abort is the one exception — the scan is stopping, so it stops here too.
 */
export async function probeTargets(i: HttpxProbeInput): Promise<HttpxProbeResult> {
  if (i.signal.aborted) throw new EngineError('nuclei aborted: server shutting down')
  const dir = join(i.workDir, HTTPX_WORK_SUBDIR)
  const targetsFile = join(dir, 'targets.txt')
  const stdoutPath = join(dir, 'stdout.jsonl')
  const stderrPath = join(dir, 'stderr.log')
  const argsFile = join(dir, 'args.json')
  const inputCount = i.targetUrls.length

  await mkdir(dir, { recursive: true })
  // Secret-artifact discipline (as for nuclei's OpenAPI docs): the target
  // lines carry query values and httpx's output echoes them, so everything
  // under httpx/ is 0600, pre-created so the tool never creates it under the
  // process umask. argv carries the headers only as a `-config` path (#95),
  // so it is persisted as-is.
  await writeSecretFile(targetsFile, i.targetUrls.join('\n') + '\n')
  for (const p of [stdoutPath, stderrPath]) await writeSecretFile(p, '')
  const args = buildHttpxArgs({
    targetsFile,
    threads: i.threads,
    rateLimit: i.rateLimit,
    headersConfigFile: i.headersConfigFile,
  })
  await writeSecretFile(argsFile, JSON.stringify(args))

  const passThrough = (
    status: Exclude<HttpxProbeStatus, 'ok'>,
    warning: string,
    partial: { durationSec: number; exitCode: number | null; stdout: string },
  ): HttpxProbeResult => {
    // Whatever httpx did observe is still recorded; only the drop rule is off.
    const { observations } = parseHttpxJsonl(partial.stdout)
    const a = annotateTargets(i.targetUrls, observations, [])
    i.logger.warn({ scanId: i.scanId, engine: 'nuclei', httpx: status, inputCount }, warning)
    return {
      kept: i.targetUrls,
      warnings: [warning],
      meta: {
        status,
        inputCount,
        observedCount: a.observedCount,
        unobservedCount: a.unobservedCount,
        failedCount: a.failedCount,
        keptCount: inputCount,
        droppedCount: 0,
        droppedUrls: [],
        statusCounts: a.statusCounts,
        pruneStatusCodes: i.pruneStatusCodes,
        durationSec: partial.durationSec,
        exitCode: partial.exitCode,
      },
    }
  }

  let result
  try {
    result = await runCommand({
      label: `httpx:${i.scanId}`,
      cmd: i.bin,
      args,
      cwd: dir,
      stdoutPath,
      stderrPath,
      timeoutMs: i.timeoutMs,
      signal: i.signal,
      logger: i.logger,
    })
  } catch (e) {
    if (e instanceof SpawnError)
      return passThrough(
        'unavailable',
        `httpx liveness probe did not run (SAKUDA_HTTPX_BIN=${i.bin} is not installed or not executable); all ${inputCount} target(s) were passed to nuclei unprobed`,
        { durationSec: 0, exitCode: null, stdout: '' },
      )
    throw e
  }
  if (result.aborted) throw new EngineError('nuclei aborted: server shutting down')

  const stdout = existsSync(stdoutPath) ? await readFile(stdoutPath, 'utf8') : ''
  const durationSec = Math.round(result.durationMs / 1000)
  if (result.timedOut)
    return passThrough(
      'timedOut',
      `httpx liveness probe was stopped after ${Math.round(i.timeoutMs / 1000)}s; all ${inputCount} target(s) were passed to nuclei unprobed`,
      { durationSec, exitCode: result.code, stdout },
    )
  if (result.code !== 0)
    return passThrough(
      'failed',
      `httpx liveness probe failed (exit ${result.code ?? 'null'}, signal ${result.signal ?? 'none'}); all ${inputCount} target(s) were passed to nuclei unprobed — see ${stderrPath}`,
      { durationSec, exitCode: result.code, stdout },
    )

  const { observations, invalidLines } = parseHttpxJsonl(stdout)
  const a = annotateTargets(i.targetUrls, observations, i.pruneStatusCodes)
  const warnings: string[] = []
  if (invalidLines > 0)
    warnings.push(`${invalidLines} unparsable line(s) in httpx's output were ignored`)
  if (inputCount > 0 && a.failedCount === inputCount)
    warnings.push(
      `httpx could not reach any of the ${inputCount} target(s) (transport failures) — the target may be down; nuclei still ran against the full list`,
    )
  if (a.dropped.length > 0)
    warnings.push(
      `httpx pruned ${a.dropped.length} target(s) whose status is on SAKUDA_HTTPX_PRUNE_STATUS_CODES (${i.pruneStatusCodes.join(',')}); ${a.kept.length} of ${inputCount} passed to nuclei — see ${stdoutPath}`,
    )
  const meta: HttpxProbeMeta = {
    status: 'ok',
    inputCount,
    observedCount: a.observedCount,
    unobservedCount: a.unobservedCount,
    failedCount: a.failedCount,
    keptCount: a.kept.length,
    droppedCount: a.dropped.length,
    droppedUrls: a.dropped,
    statusCounts: a.statusCounts,
    pruneStatusCodes: i.pruneStatusCodes,
    durationSec,
    exitCode: result.code,
  }
  // Counts only: the target lines may carry query values.
  const { droppedUrls: _droppedUrls, ...countsOnly } = meta
  i.logger.info({ scanId: i.scanId, engine: 'nuclei', httpx: countsOnly }, 'httpx probe done')
  return { kept: a.kept, meta, warnings }
}
