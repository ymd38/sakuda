import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  countParameterizedUrls,
  effectiveRiskTags,
  isActiveScanEnabled,
  riskExcludeTags,
  riskExtraTags,
  seedEmptyQueryValues,
} from '../../domain/activeScan'
import { restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { buildNonGetOpenApiDocs } from '../../domain/openapiGen'
import { countSkippedMethods, expandNucleiTargets } from '../../domain/nucleiTargets'
import type { SeverityCounts } from '#shared/types/api'
import { emptyCounts } from '#shared/utils/severity'
import { runCommand, type CommandResult } from '../runCommand'
import {
  EngineError,
  OOM_RUNBOOK,
  type EngineInput,
  type EngineRunner,
  type NewFinding,
} from '../types'
import { buildNucleiArgs, buildNucleiDastArgs, buildNucleiOpenapiArgs, nucleiTagsFor } from './args'
import {
  normalizeNucleiLines,
  parseNucleiJsonl,
  parseNucleiStats,
  parseSkippedHosts,
  type NucleiStats,
  type SkippedHost,
} from './normalize'

/** Least a phase may run before we treat the overall deadline as spent. */
const MIN_PHASE_MS = 30_000

interface PhaseOutcome {
  findings: NewFinding[]
  counts: SeverityCounts
  /** 'ok' = produced output; 'empty' = ran clean but no findings; 'partial' =
   * not a failure (see `failed` below) but did not cover its targets (a host was skipped by
   * nuclei's error guard, or the stats say fewer than 100% of planned
   * requests ran), findings or not — see #82; 'failed' = non-zero exit /
   * timeout / no output after a failure. */
  status: 'ok' | 'empty' | 'partial' | 'failed'
  result: CommandResult
  stats: NucleiStats | null
  /** Hosts nuclei dropped mid-run; non-empty only when status is 'partial'. */
  skippedHosts: SkippedHost[]
  invalidLines: number
}

/** What a GET phase did, for `meta`: `skipped` = not attempted (the DAST
 * phase on a passive run, or no GET targets). */
type GetPhaseStatus = PhaseOutcome['status'] | 'skipped'

function addCounts(into: SeverityCounts, from: SeverityCounts): void {
  for (const k of Object.keys(into) as (keyof SeverityCounts)[]) into[k] += from[k]
}

export const runNuclei: EngineRunner = async ({ scanId, site, workDir, env, logger, signal }) => {
  const { targets, excluded } = expandNucleiTargets(site)
  // Hash routes (`/#/search?q=`) are SPA client routes: the fragment never
  // reaches the server, so requesting one just GETs `/`. nuclei is
  // server-side, so it cannot test them — the zap-fe DOM XSS probe handles
  // them. Drop them here, across both bases.
  // A target's identity upstream is method+base+url, so a front line and an
  // `api:` line that resolve to the same URL (front and api may share an
  // origin) are two targets there. To nuclei they are one request: collapse
  // on method+url so neither phase, nor the counts, repeats it.
  const replayable = uniqueBy(
    targets.filter((t) => !t.url.includes('#')),
    (t) => `${t.method}|${t.url}`,
  )
  const getUrls = replayable.filter((t) => t.method === 'GET').map((t) => t.url)
  const nonGet = replayable.filter((t) => t.method !== 'GET')
  const activeScan = isActiveScanEnabled(site)
  const localAlias = env.localhostAlias

  // Non-GET replay is gated: only an active scan may attack. When on, each
  // non-GET target with a query surface or a captured body shape (#73) is
  // fuzzed via a generated OpenAPI document; one with neither has no valid fuzz
  // seed (we never invent a body) and is counted, not sent. When off, no
  // non-GET is replayed at all.
  const seedOne = (u: string) => seedEmptyQueryValues([u])[0]!
  const { docs, skippedNoFuzzSeed } = activeScan
    ? buildNonGetOpenApiDocs(
        nonGet,
        (u) => rewriteLoopbackHost(u, localAlias),
        seedOne,
        site.requestShapes,
      )
    : { docs: [], skippedNoFuzzSeed: {} }
  // skippedMethods = non-GET the run did not attempt at all. Off: every non-GET.
  // On: none here — each non-GET is either fuzzed (docs) or in skippedNoFuzzSeed.
  const skippedMethods = activeScan ? {} : countSkippedMethods(nonGet)

  if (getUrls.length === 0 && docs.length === 0)
    throw new EngineError(
      'nuclei: nothing to scan (no GET target URLs, and no non-GET target with a query to fuzz under active checks)',
    )

  const riskTags = effectiveRiskTags(site)
  const tags = [...nucleiTagsFor(site.headers.length > 0), ...riskExtraTags(riskTags)]
  const parameterizedUrlCount = countParameterizedUrls(getUrls)
  await mkdir(workDir, { recursive: true })

  logger.info(
    {
      scanId,
      engine: 'nuclei',
      urlCount: getUrls.length,
      excludedCount: excluded.length,
      openapiDocCount: docs.length,
      tags,
      activeScan,
      riskTags,
      parameterizedUrlCount,
      rateLimit: site.nucleiRateLimit,
      headerNames: site.headerNames,
    },
    'nuclei start',
  )

  const deadline = Date.now() + env.nuclei.maxMinutes * 60_000
  const remaining = () => deadline - Date.now()
  const findings: NewFinding[] = []
  const counts = emptyCounts()
  const warnings: string[] = []
  let anyFailed = false
  let anyRan = false
  // A phase that ran to completion, findings or not: "every phase failed"
  // must not be inferred from an empty finding count, since a clean phase
  // with nothing to report looks the same there.
  let anyCompleted = false
  let anAborted = false
  let anOom = false
  let timedOut = false
  let getStats: NucleiStats | null = null
  let dastStats: NucleiStats | null = null
  let signaturePhase: GetPhaseStatus = 'skipped'
  let dastPhase: GetPhaseStatus = 'skipped'
  const unaliasFront = (u: string) =>
    restoreLoopbackHost(u, localAlias, new URL(site.frontBaseUrl).hostname)

  // Folds one GET phase's outcome into the run: findings on success, a
  // warning on failure, and the abort/OOM/timeout flags either way.
  const absorb = (phase: PhaseOutcome, label: string, stderrPath: string): void => {
    anyRan = true
    if (phase.result.aborted) anAborted = true
    if (phase.result.oomKilled) anOom = true
    if (phase.result.timedOut) timedOut = true
    if (phase.status === 'failed') {
      anyFailed = true
      warnings.push(
        `nuclei ${label} phase failed (exit ${phase.result.code ?? 'null'}, signal ${phase.result.signal ?? 'none'}${phase.result.timedOut ? ', timed out' : ''}); see ${stderrPath}`,
      )
    } else {
      anyCompleted = true
      findings.push(...phase.findings)
      addCounts(counts, phase.counts)
      if (phase.status === 'partial') warnings.push(partialPhaseWarning(label, phase, stderrPath))
    }
    if (phase.invalidLines > 0)
      warnings.push(`${phase.invalidLines} unparsable JSONL line(s) ignored (${label} phase)`)
  }

  // Both GET phases read the same targets file (seeded query values under
  // active checks), so it is written once, ahead of either.
  const targetsFile = join(workDir, 'targets.txt')
  if (getUrls.length > 0) {
    const targetUrls = activeScan ? seedEmptyQueryValues(getUrls) : getUrls
    await writeFile(
      targetsFile,
      targetUrls.map((u) => rewriteLoopbackHost(u, localAlias)).join('\n') + '\n',
    )
  }

  // --- phase 1a: GET URL list, DAST templates (active checks only) --------
  // Runs FIRST: the DAST tree is ~20 templates and finishes in well under a
  // minute, while the signature tree can run for hours on a large target
  // list. The phases share one engine budget (`env.nuclei.maxMinutes`), so
  // the short one must not queue behind the long one — with the host-error
  // guard off (#82) the signature phase now routinely reaches the budget,
  // and running DAST second would silently skip it every time.
  // A separate nuclei run because `-dast` is exclusive; same targets file
  // and tag lists as the signature phase, so the risk opt-ins gate it
  // identically.
  if (activeScan && getUrls.length > 0) {
    const outputFile = join(workDir, 'dast-findings.jsonl')
    const stdoutPath = join(workDir, 'dast-stdout.log')
    const stderrPath = join(workDir, 'dast-stderr.log')
    const args = buildNucleiDastArgs({
      targetsFile,
      dastTemplatesDir: env.nuclei.dastTemplatesDir,
      outputFile,
      rateLimit: site.nucleiRateLimit,
      concurrency: 25,
      tags,
      excludeTags: riskExcludeTags(riskTags),
      headers: site.headers,
    })
    const phase = await runNucleiPhase({
      label: `nuclei-dast:${scanId}`,
      cmd: env.nuclei.bin,
      args,
      workDir,
      outputFile,
      stdoutPath,
      stderrPath,
      timeoutMs: Math.max(remaining(), MIN_PHASE_MS),
      signal,
      logger,
      unalias: unaliasFront,
      readStats: true,
    })
    absorb(phase, 'DAST', stderrPath)
    dastPhase = phase.status
    dastStats = phase.stats
  }

  // --- phase 1b: the same GET list, signature templates (the `http` tree) --
  // Same argv in both modes except the tag lists; never `-dast`, which
  // would make nuclei run DAST templates only and drop every signature
  // template (#65).
  if (getUrls.length > 0 && !anAborted) {
    if (remaining() <= 0) {
      warnings.push(
        'nuclei was stopped by the engine timeout before the signature phase started; results are partial',
      )
      timedOut = true
    } else {
      const outputFile = join(workDir, 'findings.jsonl')
      const stdoutPath = join(workDir, 'stdout.log')
      const stderrPath = join(workDir, 'stderr.log')
      const args = buildNucleiArgs({
        targetsFile,
        templatesDir: env.nuclei.templatesDir,
        outputFile,
        rateLimit: site.nucleiRateLimit,
        concurrency: 25,
        tags,
        headers: site.headers,
        excludeTags: riskExcludeTags(riskTags),
      })
      const phase = await runNucleiPhase({
        label: `nuclei:${scanId}`,
        cmd: env.nuclei.bin,
        args,
        workDir,
        outputFile,
        stdoutPath,
        stderrPath,
        timeoutMs: Math.max(remaining(), MIN_PHASE_MS),
        signal,
        logger,
        unalias: unaliasFront,
        readStats: true,
      })
      absorb(phase, 'signature', stderrPath)
      signaturePhase = phase.status
      getStats = phase.stats
    }
  }

  // --- phase 2: non-GET via generated OpenAPI (one nuclei run per doc) -----
  let openapiDocsRun = 0
  for (let i = 0; i < docs.length; i++) {
    if (anAborted) break
    if (remaining() <= 0) {
      warnings.push(
        'nuclei was stopped by the engine timeout before the OpenAPI phase finished; results are partial',
      )
      timedOut = true
      break
    }
    const d = docs[i]!
    const docFile = join(workDir, `openapi-${i}.json`)
    const outputFile = join(workDir, `openapi-findings-${i}.jsonl`)
    const stdoutPath = join(workDir, `openapi-stdout-${i}.log`)
    const stderrPath = join(workDir, `openapi-stderr-${i}.log`)
    try {
      // Secret-artifact discipline: the doc carries the site's query values,
      // and the outputs may echo them; write everything 0600 and pre-create
      // the tool-written outputs so nuclei does not create them under the
      // process umask. All four are removed in `finally`.
      await writeFile(docFile, JSON.stringify(d.doc), { mode: 0o600 })
      for (const p of [outputFile, stdoutPath, stderrPath]) await writeFile(p, '', { mode: 0o600 })
      const args = buildNucleiOpenapiArgs({
        openapiFile: docFile,
        dastTemplatesDir: env.nuclei.dastTemplatesDir,
        outputFile,
        rateLimit: site.nucleiRateLimit,
        concurrency: 25,
        headers: site.headers,
      })
      const phase = await runNucleiPhase({
        label: `nuclei-openapi:${scanId}:${i}`,
        cmd: env.nuclei.bin,
        args,
        workDir,
        outputFile,
        stdoutPath,
        stderrPath,
        timeoutMs: Math.max(remaining(), MIN_PHASE_MS),
        signal,
        logger,
        unalias: (u) => restoreLoopbackHost(u, localAlias, d.originalHost),
        readStats: false,
      })
      anyRan = true
      openapiDocsRun++
      if (phase.result.aborted) anAborted = true
      if (phase.result.oomKilled) anOom = true
      if (phase.result.timedOut) timedOut = true
      if (phase.status === 'failed') {
        anyFailed = true
        warnings.push(
          `nuclei OpenAPI phase failed for one origin (exit ${phase.result.code ?? 'null'}, signal ${phase.result.signal ?? 'none'}${phase.result.timedOut ? ', timed out' : ''})`,
        )
      } else {
        anyCompleted = true
        findings.push(...phase.findings)
        addCounts(counts, phase.counts)
      }
    } finally {
      for (const p of [docFile, outputFile, stdoutPath, stderrPath]) await rm(p, { force: true })
    }
  }

  if (anAborted) throw new EngineError('nuclei aborted: server shutting down')
  // Every attempted phase failed → a real failure. A phase that completed
  // with no findings counts as success here, so a partial run is reported
  // with warnings and exit 1 rather than thrown away.
  if (anyRan && anyFailed && !anyCompleted)
    throw new EngineError(
      'nuclei produced no output; every phase failed — see the per-phase logs in the work dir',
      anOom ? OOM_RUNBOOK : undefined,
    )

  if (timedOut)
    warnings.push(`nuclei was stopped after ${env.nuclei.maxMinutes} min; results are partial`)
  // Error rate over both GET phases: they hit the same targets, so one
  // rate-limit verdict covers them.
  const req = Number(getStats?.requests ?? 0) + Number(dastStats?.requests ?? 0)
  const errs = Number(getStats?.errors ?? 0) + Number(dastStats?.errors ?? 0)
  if (req > 0 && errs / req > 0.05)
    warnings.push(
      `error rate ${((errs / req) * 100).toFixed(1)}% (${errs}/${req}); coverage may be reduced — lower nucleiRateLimit`,
    )
  // The "nothing to fuzz" warning should account for the OpenAPI phase too:
  // an emitted non-GET op is a fuzz target even when no GET URL is parameterized.
  if (activeScan && parameterizedUrlCount === 0 && openapiDocsRun === 0)
    warnings.push(
      'active injection checks are on but no saved target has query parameters, so the DAST templates had nothing to fuzz — add parameterized paths (e.g. /search?q=) to the target list',
    )

  return {
    findings,
    counts,
    warnings,
    // Non-zero when any attempted phase failed, so the run is not reported as
    // a clean exit; the scan is still stored `done`, hence the warnings/meta.
    exitCode: anyFailed ? 1 : 0,
    signal: null,
    meta: {
      urlCount: getUrls.length,
      excludedUrls: excluded,
      ...(Object.keys(skippedMethods).length > 0 ? { skippedMethods } : {}),
      ...(Object.keys(skippedNoFuzzSeed).length > 0 ? { skippedNoFuzzSeed } : {}),
      ...(docs.length > 0 ? { openapiDocCount: docs.length, openapiDocsRun } : {}),
      tags,
      rateLimit: site.nucleiRateLimit,
      concurrency: 25,
      templatesDir: env.nuclei.templatesDir,
      activeScan,
      riskTags,
      ...(activeScan ? { dastTemplatesDir: env.nuclei.dastTemplatesDir } : {}),
      parameterizedUrlCount,
      signaturePhase,
      dastPhase,
      stats: getStats,
      ...(dastStats ? { dastStats } : {}),
      timedOut,
    },
  }
}

/** First occurrence per key, order preserved. */
function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

interface PhaseInput {
  label: string
  cmd: string
  args: string[]
  workDir: string
  outputFile: string
  stdoutPath: string
  stderrPath: string
  timeoutMs: number
  signal: AbortSignal
  logger: EngineInput['logger']
  unalias: (u: string) => string
  readStats: boolean
}

/** Runs one nuclei invocation and normalizes its JSONL output. Never throws
 * for an ordinary process failure — the caller decides how a failed phase
 * affects the whole run — but propagates nothing it swallows: an aborted or
 * OOM run is reflected in `result`. */
async function runNucleiPhase(i: PhaseInput): Promise<PhaseOutcome> {
  const result = await runCommand({
    label: i.label,
    cmd: i.cmd,
    args: i.args,
    cwd: i.workDir,
    stdoutPath: i.stdoutPath,
    stderrPath: i.stderrPath,
    timeoutMs: i.timeoutMs,
    signal: i.signal,
    logger: i.logger,
  })
  const jsonl = existsSync(i.outputFile) ? await readFile(i.outputFile, 'utf8') : ''
  const { lines, invalidLines } = parseNucleiJsonl(jsonl)
  const stats = i.readStats
    ? parseNucleiStats(
        (existsSync(i.stdoutPath) ? await readFile(i.stdoutPath, 'utf8') : '') +
          '\n' +
          (existsSync(i.stderrPath) ? await readFile(i.stderrPath, 'utf8') : ''),
      )
    : null
  const skippedHosts = i.readStats
    ? parseSkippedHosts(existsSync(i.stderrPath) ? await readFile(i.stderrPath, 'utf8') : '')
    : []
  const failed = result.aborted || (result.code !== 0 && !result.timedOut && lines.length === 0)
  // A run our own timeout or abort cut short is already reported as such;
  // 'partial' is for a run nuclei itself ended early while exiting cleanly.
  const partial =
    !failed && !result.timedOut && (skippedHosts.length > 0 || coveragePercent(stats) < 100)
  const { findings, counts } = normalizeNucleiLines(lines, i.unalias)
  return {
    findings,
    counts,
    status: failed ? 'failed' : partial ? 'partial' : lines.length > 0 ? 'ok' : 'empty',
    result,
    stats,
    skippedHosts,
    invalidLines,
  }
}

/** Percent of planned requests nuclei reports as executed; 100 when the stats
 * carry no `percent` (older nuclei, or a phase run without `-stats-json`),
 * so a missing field never flags a clean run as partial. */
function coveragePercent(stats: NucleiStats | null): number {
  const n = Number(stats?.percent)
  return stats?.percent !== undefined && Number.isFinite(n) ? n : 100
}

/** Runbook-friendly warning for a phase nuclei ended early on its own: names
 * the skipped hosts and their error counts, and the executed share of the
 * planned requests, so the reader can tell "no findings" from "not covered". */
function partialPhaseWarning(label: string, phase: PhaseOutcome, stderrPath: string): string {
  const skipped =
    phase.skippedHosts.length > 0
      ? `host ${phase.skippedHosts.map((h) => `${h.host} was skipped after ${h.errors} errors`).join(', ')} (nuclei -max-host-error guard); `
      : ''
  const s = phase.stats
  const coverage =
    s?.percent !== undefined
      ? `${s.percent}% of planned requests executed (${s.requests ?? '?'}/${s.total ?? '?'}, ${s.errors ?? '?'} errors)`
      : 'nuclei ended before covering its targets'
  return `nuclei ${label} phase is partial: ${skipped}${coverage} — results are incomplete. Check the target's error responses or lower nucleiRateLimit; see ${stderrPath}`
}
