import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isActiveScanEnabled, seedEmptyQueryValues } from '../../domain/activeScan'
import { escapeRegex, zapExcludeRegexes } from '../../domain/excludePaths'
import { joinUrl, restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { zapFeHashRouteTargets, zapFeRequestTargets } from '../../domain/nucleiTargets'
import { EngineError, OOM_RUNBOOK, type EngineRunner } from '../types'
import { buildZapFePlan, planToYaml, ZAP_REPORT_JSON } from './plan'
import { buildFirefoxPrefsConfig } from './firefoxPrefs'
import { buildReplacerConf } from './replacer'
import { normalizeZapReport, parseZapReport } from './report'
import { runZap, zapPath } from './runZap'
import {
  BROWSER_STORAGE_SCRIPT_ENGINE,
  BROWSER_STORAGE_SCRIPT_FILE,
  BROWSER_STORAGE_SCRIPT_NAME,
  buildBrowserStorageScript,
} from './browserStorageScript'
import {
  buildDomXssProbeScript,
  parseDomXssProbeSummary,
  DOM_XSS_PROBE_OUTPUT_FILE,
  DOM_XSS_PROBE_SCRIPT_ENGINE,
  DOM_XSS_PROBE_SCRIPT_FILE,
  DOM_XSS_PROBE_SCRIPT_NAME,
} from './domXssProbeScript'

/** Wall-clock budget for the whole DOM XSS probe and per-navigation settle. */
const DOM_XSS_PROBE_BUDGET_MINUTES = 10
const DOM_XSS_PROBE_SETTLE_MS = 1_500

export const runZapFe: EngineRunner = async ({ scanId, site, workDir, env, logger, signal }) => {
  const alias = env.zap.localhostAlias
  const originalHost = new URL(site.frontBaseUrl).hostname
  const base = rewriteLoopbackHost(site.frontBaseUrl + '/', alias).replace(/\/$/, '')
  const seedUrl = joinUrl(base, site.zapFeSeedPath)
  const excludeRegexes = zapExcludeRegexes(site.excludePaths)
  const passiveMaxMinutes = 5
  const hasBrowserStorage = site.browserStorage.length > 0
  // The single source of truth for "may this scan attack the target" —
  // never decided here, only read (see domain/activeScan). The cap reuses the
  // site's ZAP API limit: it is the one active-scan budget the site defines.
  const activeScan = isActiveScanEnabled(site)
  const activeScanMaxMinutes = activeScan ? site.zapApiMaxMinutes : 0
  // Saved targets the spiders may never reach get requested up front so the
  // scans see them; an active run seeds empty query values (`?q=` → `?q=1`)
  // exactly as nuclei's transient targets file does — the saved list is untouched.
  const savedTargets = zapFeRequestTargets(site).map((u) => rewriteLoopbackHost(u, alias))
  const requestUrls = activeScan ? seedEmptyQueryValues(savedTargets) : savedTargets
  // Hash-route targets (`/#/search?q=`) can only be tested from a real
  // browser (the fragment never reaches ZAP's proxy), and only when the site
  // opted into active checks. The probe injects into the empty query value
  // itself, so unlike requestUrls these are not seeded here.
  const hashRoutes = activeScan
    ? zapFeHashRouteTargets(site).map((u) => rewriteLoopbackHost(u, alias))
    : []
  const runDomXssProbe = hashRoutes.length > 0
  const plan = buildZapFePlan({
    context: {
      name: 'sakuda',
      urls: [seedUrl],
      includePaths: [`^${escapeRegex(base)}(/.*)?$`],
      excludePaths: excludeRegexes,
    },
    seedUrl,
    ...(hasBrowserStorage
      ? {
          browserScript: {
            file: zapPath(env, workDir, BROWSER_STORAGE_SCRIPT_FILE),
            name: BROWSER_STORAGE_SCRIPT_NAME,
            engine: BROWSER_STORAGE_SCRIPT_ENGINE,
          },
        }
      : {}),
    spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
    ajaxMaxMinutes: site.zapFeSpiderMaxMinutes,
    passiveMaxMinutes,
    ...(activeScan ? { activeScan: { maxScanMinutes: activeScanMaxMinutes } } : {}),
    requestUrls,
    ...(runDomXssProbe
      ? {
          domXssProbe: {
            file: zapPath(env, workDir, DOM_XSS_PROBE_SCRIPT_FILE),
            name: DOM_XSS_PROBE_SCRIPT_NAME,
            engine: DOM_XSS_PROBE_SCRIPT_ENGINE,
          },
        }
      : {}),
    reportDir: zapPath(env, workDir, '') + '/',
  })
  logger.info(
    {
      scanId,
      engine: 'zap-fe',
      seedUrl: joinUrl(site.frontBaseUrl, site.zapFeSeedPath),
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      activeScan,
      activeScanMaxMinutes,
      targetUrlCount: requestUrls.length,
      hashRouteCount: hashRoutes.length,
      headerNames: site.headerNames,
      browserStorageNames: site.browserStorageNames,
    },
    'zap-fe start',
  )
  const timeoutMs =
    (site.zapFeSpiderMaxMinutes * 2 +
      activeScanMaxMinutes +
      (runDomXssProbe ? DOM_XSS_PROBE_BUDGET_MINUTES : 0) +
      passiveMaxMinutes +
      env.engineGraceMinutes) *
    60_000
  const run = await runZap({
    label: `zap-fe:${scanId}`,
    env,
    workDir,
    planYaml: planToYaml(plan),
    replacerConf: site.headers.length ? buildReplacerConf(site.headers) : null,
    config: buildFirefoxPrefsConfig(alias),
    ...(runDomXssProbe
      ? {
          extraFiles: {
            [DOM_XSS_PROBE_SCRIPT_FILE]: buildDomXssProbeScript({
              routes: hashRoutes,
              origin: base,
              outputPath: zapPath(env, workDir, DOM_XSS_PROBE_OUTPUT_FILE),
              budgetMs: DOM_XSS_PROBE_BUDGET_MINUTES * 60_000,
              settleMs: DOM_XSS_PROBE_SETTLE_MS,
            }),
          },
        }
      : {}),
    ...(hasBrowserStorage
      ? {
          secretFiles: {
            [BROWSER_STORAGE_SCRIPT_FILE]: buildBrowserStorageScript(site.browserStorage, [base]),
          },
        }
      : {}),
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
  // The DOM XSS probe raises its findings as ZAP alerts (already in `n`); its
  // summary file only tells us whether the wall-clock budget cut it short.
  const domXssSummary = runDomXssProbe ? await readDomXssProbeSummary(workDir) : null
  const warnings: string[] = []
  if (domXssSummary?.truncated)
    warnings.push(
      `DOM XSS probe hit its ${DOM_XSS_PROBE_BUDGET_MINUTES}-minute budget before covering every hash route — some routes were not tested`,
    )
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
      browserStorage: site.browserStorageNames.map((n) => `${n.kind}:${n.name}`),
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      activeScan,
      ...(activeScan ? { activeScanMaxMinutes } : {}),
      targetUrlCount: requestUrls.length,
      hashRouteCount: hashRoutes.length,
      ...(domXssSummary
        ? { domXssProbed: domXssSummary.probed, domXssTruncated: domXssSummary.truncated }
        : {}),
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

/** Reads the DOM XSS probe's `{probed,hits,truncated}` summary from the work
 * dir; null if the script never wrote it (e.g. it crashed before the run).
 * The summary is optional telemetry, so a read error (the file vanished
 * between the check and the read, permissions) degrades to null rather than
 * failing a scan that has already finished. */
async function readDomXssProbeSummary(workDir: string) {
  const path = join(workDir, DOM_XSS_PROBE_OUTPUT_FILE)
  if (!existsSync(path)) return null
  try {
    return parseDomXssProbeSummary(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}
