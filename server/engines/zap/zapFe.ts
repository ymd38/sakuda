import { join } from 'node:path'
import { escapeRegex, parseExcludePatterns, toZapExcludeRegex } from '../../domain/excludePaths'
import { joinUrl, restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { EngineError, OOM_RUNBOOK, type EngineRunner } from '../types'
import { buildZapFePlan, planToYaml, ZAP_REPORT_JSON } from './plan'
import { buildReplacerConf } from './replacer'
import { normalizeZapReport, parseZapReport } from './report'
import { runZap, zapPath } from './runZap'

export const runZapFe: EngineRunner = async ({ scanId, site, workDir, env, logger, signal }) => {
  const alias = env.zap.localhostAlias
  const originalHost = new URL(site.frontBaseUrl).hostname
  const base = rewriteLoopbackHost(site.frontBaseUrl + '/', alias).replace(/\/$/, '')
  const seedUrl = joinUrl(base, site.zapFeSeedPath)
  const excludeRegexes = parseExcludePatterns(site.excludePaths).map(toZapExcludeRegex)
  const passiveMaxMinutes = 5
  const plan = buildZapFePlan({
    context: {
      name: 'sakuda',
      urls: [seedUrl],
      includePaths: [`^${escapeRegex(base)}(/.*)?$`],
      excludePaths: excludeRegexes,
    },
    seedUrl,
    spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
    ajaxMaxMinutes: site.zapFeSpiderMaxMinutes,
    passiveMaxMinutes,
    reportDir: zapPath(env, workDir, '') + '/',
  })
  logger.info(
    {
      scanId,
      engine: 'zap-fe',
      seedUrl: joinUrl(site.frontBaseUrl, site.zapFeSeedPath),
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      headerNames: site.headerNames,
    },
    'zap-fe start',
  )
  const timeoutMs =
    (site.zapFeSpiderMaxMinutes * 2 + passiveMaxMinutes + env.engineGraceMinutes) * 60_000
  const run = await runZap({
    label: `zap-fe:${scanId}`,
    env,
    workDir,
    planYaml: planToYaml(plan),
    replacerConf: site.headers.length ? buildReplacerConf(site.headers) : null,
    timeoutMs,
    signal,
    logger,
  })
  if (run.result.aborted) throw new EngineError('zap-fe aborted: server shutting down')
  if (run.reportText === null)
    throw new EngineError(
      `zap-fe produced no ${ZAP_REPORT_JSON} (exit ${run.result.code ?? 'null'}, signal ${run.result.signal ?? 'none'}${run.result.timedOut ? ', timed out' : ''}); see ${join(workDir, 'stdout.log')}`,
      run.result.oomKilled ? OOM_RUNBOOK : undefined,
    )
  const n = normalizeZapReport(parseZapReport(run.reportText), 'zap-fe', (u) =>
    restoreLoopbackHost(u, alias, originalHost),
  )
  const warnings: string[] = []
  if (
    site.headers.length > 0 &&
    site.zapFeSeedPath !== '/' &&
    !n.reachedUrls.some((u) => u.includes(site.zapFeSeedPath))
  )
    warnings.push(
      `seed path ${site.zapFeSeedPath} was not among reached URLs — the spider may not have been authenticated; check the site headers`,
    )
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
      seedUrl: joinUrl(site.frontBaseUrl, site.zapFeSeedPath),
      spider: 'traditional + ajax',
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      reachedUrlCount: n.reachedUrls.length,
      reachedUrls: n.reachedUrls.slice(0, 200),
      authFailureCount: n.authFailureCount,
      alertCounts: n.alertCounts,
      excludeRegexes,
      durationSec: Math.round(run.result.durationMs / 1000),
      timedOut: run.result.timedOut,
    },
  }
}
