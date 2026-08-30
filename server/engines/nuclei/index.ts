import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { expandNucleiTargets, mergeCrawledTargets } from '../../domain/nucleiTargets'
import { runCommand } from '../runCommand'
import { EngineError, OOM_RUNBOOK, type EngineRunner } from '../types'
import { buildNucleiArgs, nucleiTagsFor } from './args'
import { normalizeNucleiLines, parseNucleiJsonl, parseNucleiStats } from './normalize'

export const runNuclei: EngineRunner = async ({
  scanId,
  site,
  workDir,
  env,
  logger,
  signal,
  extraTargets,
}) => {
  const expanded = expandNucleiTargets(site)
  const { urls, dropped: crawledDropped } = mergeCrawledTargets(
    site,
    expanded.urls,
    extraTargets ?? [],
  )
  const excluded = expanded.excluded
  const crawledTargetCount = urls.length - expanded.urls.length
  if (urls.length === 0)
    throw new EngineError('nuclei: no target URLs (nucleiPaths is empty or every path is excluded)')
  const originalHost = new URL(site.frontBaseUrl).hostname
  const targetsFile = join(workDir, 'targets.txt')
  const outputFile = join(workDir, 'findings.jsonl')
  await mkdir(workDir, { recursive: true })
  await writeFile(
    targetsFile,
    urls.map((u) => rewriteLoopbackHost(u, env.localhostAlias)).join('\n') + '\n',
  )
  const tags = nucleiTagsFor(site.headers.length > 0)
  const args = buildNucleiArgs({
    targetsFile,
    templatesDir: env.nuclei.templatesDir,
    outputFile,
    rateLimit: site.nucleiRateLimit,
    concurrency: 25,
    tags,
    headers: site.headers,
  })
  logger.info(
    {
      scanId,
      engine: 'nuclei',
      urlCount: urls.length,
      excludedCount: excluded.length,
      crawledTargetCount,
      crawledDropped,
      tags,
      rateLimit: site.nucleiRateLimit,
      headerNames: site.headerNames,
    },
    'nuclei start',
  )
  // Never log the crawled URLs themselves at info level (they may carry
  // query strings with sensitive values) — counts only above.
  logger.debug(
    { scanId, engine: 'nuclei', extraTargets: extraTargets ?? [] },
    'nuclei extra targets',
  )
  const stdoutPath = join(workDir, 'stdout.log')
  const stderrPath = join(workDir, 'stderr.log')
  const result = await runCommand({
    label: `nuclei:${scanId}`,
    cmd: env.nuclei.bin,
    args,
    cwd: workDir,
    stdoutPath,
    stderrPath,
    timeoutMs: env.nuclei.maxMinutes * 60_000,
    signal,
    logger,
  })
  if (result.aborted) throw new EngineError('nuclei aborted: server shutting down')
  const jsonl = existsSync(outputFile) ? await readFile(outputFile, 'utf8') : ''
  const { lines, invalidLines } = parseNucleiJsonl(jsonl)
  if (result.code !== 0 && !result.timedOut && lines.length === 0)
    throw new EngineError(
      `nuclei exited with code ${result.code ?? 'null'} signal ${result.signal ?? 'none'} and produced no output; check ${stderrPath}`,
      result.oomKilled ? OOM_RUNBOOK : undefined,
    )
  const { findings, counts } = normalizeNucleiLines(lines, (u) =>
    restoreLoopbackHost(u, env.localhostAlias, originalHost),
  )
  const stats = parseNucleiStats(
    (await readFile(stdoutPath, 'utf8')) + '\n' + (await readFile(stderrPath, 'utf8')),
  )
  const warnings: string[] = []
  if (result.timedOut)
    warnings.push(`nuclei was stopped after ${env.nuclei.maxMinutes} min; results are partial`)
  const req = Number(stats?.requests ?? 0)
  const errs = Number(stats?.errors ?? 0)
  if (req > 0 && errs / req > 0.05)
    warnings.push(
      `error rate ${((errs / req) * 100).toFixed(1)}% (${errs}/${req}); coverage may be reduced — lower nucleiRateLimit`,
    )
  if (invalidLines > 0) warnings.push(`${invalidLines} unparsable JSONL line(s) ignored`)
  return {
    findings,
    counts,
    warnings,
    exitCode: result.code,
    signal: result.signal,
    meta: {
      urlCount: urls.length,
      excludedUrls: excluded,
      crawledTargetCount,
      crawledDropped,
      tags,
      rateLimit: site.nucleiRateLimit,
      concurrency: 25,
      templatesDir: env.nuclei.templatesDir,
      stats,
      durationSec: Math.round(result.durationMs / 1000),
      timedOut: result.timedOut,
    },
  }
}
