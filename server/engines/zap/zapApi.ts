import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { escapeRegex, zapExcludeRegexes } from '../../domain/excludePaths'
import { restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { EngineError, OOM_RUNBOOK, type EngineRunner } from '../types'
import { buildZapApiPlan, planToYaml, ZAP_REPORT_JSON } from './plan'
import { buildReplacerConf } from './replacer'
import { normalizeZapReport, parseZapReport } from './report'
import { runZap, zapPath } from './runZap'

export const runZapApi: EngineRunner = async ({ scanId, site, workDir, env, logger, signal }) => {
  if (!site.openapiUrl && !site.openapiJson)
    throw new EngineError('zap-api requires openapiUrl or openapiJson')

  const alias = env.zap.localhostAlias
  const targetBase = site.apiBaseUrl ?? site.frontBaseUrl
  const originalHost = new URL(targetBase).hostname
  const aliasedBase = rewriteLoopbackHost(targetBase + '/', alias).replace(/\/$/, '')

  let openapi: { apiFile: string } | { apiUrl: string }
  let openapiSource: 'pasted' | 'url'
  if (site.openapiJson) {
    await mkdir(workDir, { recursive: true })
    await writeFile(join(workDir, 'openapi.json'), site.openapiJson)
    openapi = { apiFile: zapPath(env, workDir, 'openapi.json') }
    openapiSource = 'pasted'
  } else {
    // site.openapiUrl is guaranteed set here: the guard above requires one of the two.
    openapi = { apiUrl: rewriteLoopbackHost(site.openapiUrl as string, alias) }
    openapiSource = 'url'
  }

  const excludeRegexes = zapExcludeRegexes(site.excludePaths)
  const passiveMaxMinutes = 5
  const plan = buildZapApiPlan({
    context: {
      name: 'sakuda',
      urls: [aliasedBase + '/'],
      includePaths: [`^${escapeRegex(aliasedBase)}(/.*)?$`],
      excludePaths: excludeRegexes,
    },
    openapi,
    targetUrl: aliasedBase,
    maxScanMinutes: site.zapApiMaxMinutes,
    passiveMaxMinutes,
    reportDir: zapPath(env, workDir, '') + '/',
  })
  logger.info(
    {
      scanId,
      engine: 'zap-api',
      targetUrl: targetBase,
      openapiSource,
      maxScanMinutes: site.zapApiMaxMinutes,
      headerNames: site.headerNames,
    },
    'zap-api start',
  )
  const timeoutMs = (site.zapApiMaxMinutes + passiveMaxMinutes + env.engineGraceMinutes) * 60_000
  const run = await runZap({
    label: `zap-api:${scanId}`,
    env,
    workDir,
    planYaml: planToYaml(plan),
    replacerConf: site.headers.length ? buildReplacerConf(site.headers) : null,
    timeoutMs,
    signal,
    logger,
  })
  if (run.result.aborted) throw new EngineError('zap-api aborted: server shutting down')
  if (run.reportText === null)
    throw new EngineError(
      `zap-api produced no ${ZAP_REPORT_JSON} (exit ${run.result.code ?? 'null'}, signal ${run.result.signal ?? 'none'}${run.result.timedOut ? ', timed out' : ''}); see ${join(workDir, 'stdout.log')}`,
      run.result.oomKilled ? OOM_RUNBOOK : undefined,
    )
  const n = normalizeZapReport(parseZapReport(run.reportText), 'zap-api', (u) =>
    restoreLoopbackHost(u, alias, originalHost),
  )
  const warnings: string[] = []
  if (n.authFailureCount > 0)
    warnings.push(`${n.authFailureCount} request(s) got 401/403 — headers may be expired`)
  if (n.totalAlerts === 0)
    warnings.push(
      'ZAP returned zero alerts of any severity — verify the target was reachable before trusting this result',
    )
  if (run.result.timedOut)
    warnings.push('ZAP was stopped by the engine timeout; the report may be partial')
  return {
    findings: n.findings,
    counts: n.counts,
    warnings,
    exitCode: run.result.code,
    signal: run.result.signal,
    meta: {
      zapVersion: n.zapVersion,
      targetUrl: targetBase,
      openapiSource,
      maxScanMinutes: site.zapApiMaxMinutes,
      authFailureCount: n.authFailureCount,
      alertCounts: n.alertCounts,
      reachedUrlCount: n.reachedUrls.length,
      excludeRegexes,
      durationSec: Math.round(run.result.durationMs / 1000),
      timedOut: run.result.timedOut,
    },
  }
}
