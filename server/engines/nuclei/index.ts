import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import { expandNucleiTargets } from '../../domain/nucleiTargets'
import { runCommand } from '../runCommand'
import { EngineError, OOM_RUNBOOK, type EngineRunner } from '../types'
import { buildNucleiArgs, nucleiTagsFor } from './args'
import { normalizeNucleiLines, parseNucleiJsonl, parseNucleiStats } from './normalize'

export const runNuclei: EngineRunner = async ({ scanId, site, workDir, env, logger, signal }) => {
  const { urls, excluded } = expandNucleiTargets(site)
  if (urls.length === 0)
    throw new EngineError('nuclei: no target URLs (nucleiPaths is empty or every path is excluded)')
  const originalHost = new URL(site.frontBaseUrl).hostname
  const targetsFile = join(workDir, 'targets.txt')
  const outputFile = join(workDir, 'findings.jsonl')
  // The single source of truth for "may this scan attack the target" —
  // never decided here, only read (see domain/activeScan).
  const activeScan = isActiveScanEnabled(site)
  // Risk-template groups the user opted this site into (empty unless active);
  // each adds its templates back via -tags and lifts them from -exclude-tags.
  const riskTags = effectiveRiskTags(site)
  const tags = [...nucleiTagsFor(site.headers.length > 0), ...riskExtraTags(riskTags)]
  const parameterizedUrlCount = countParameterizedUrls(urls)
  // Active runs seed empty query values (`?q=` → `?q=1`) so the DAST fuzzer
  // has something to mutate; only the transient targets file changes, not
  // the site's saved list.
  const targetUrls = activeScan ? seedEmptyQueryValues(urls) : urls
  await mkdir(workDir, { recursive: true })
  await writeFile(
    targetsFile,
    targetUrls.map((u) => rewriteLoopbackHost(u, env.localhostAlias)).join('\n') + '\n',
  )
  const args = buildNucleiArgs({
    targetsFile,
    templatesDir: env.nuclei.templatesDir,
    outputFile,
    rateLimit: site.nucleiRateLimit,
    concurrency: 25,
    tags,
    headers: site.headers,
    excludeTags: riskExcludeTags(riskTags),
    ...(activeScan ? { dastTemplatesDir: env.nuclei.dastTemplatesDir } : {}),
  })
  logger.info(
    {
      scanId,
      engine: 'nuclei',
      urlCount: urls.length,
      excludedCount: excluded.length,
      tags,
      activeScan,
      riskTags,
      parameterizedUrlCount,
      rateLimit: site.nucleiRateLimit,
      headerNames: site.headerNames,
    },
    'nuclei start',
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
  if (activeScan && parameterizedUrlCount === 0)
    warnings.push(
      'active injection checks are on but no saved target has query parameters, so the DAST templates had nothing to fuzz — add parameterized paths (e.g. /search?q=) to the target list',
    )
  return {
    findings,
    counts,
    warnings,
    exitCode: result.code,
    signal: result.signal,
    meta: {
      urlCount: urls.length,
      excludedUrls: excluded,
      tags,
      rateLimit: site.nucleiRateLimit,
      concurrency: 25,
      templatesDir: env.nuclei.templatesDir,
      activeScan,
      riskTags,
      ...(activeScan ? { dastTemplatesDir: env.nuclei.dastTemplatesDir } : {}),
      parameterizedUrlCount,
      stats,
      durationSec: Math.round(result.durationMs / 1000),
      timedOut: result.timedOut,
    },
  }
}
