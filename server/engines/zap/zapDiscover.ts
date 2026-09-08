import { join } from 'node:path'
import {
  crawledUrlKey,
  isApiCall,
  normalizeCrawledEntries,
  spaLikelyDidNotStart,
} from '../../domain/crawledUrls'
import { isActiveScanEnabled } from '../../domain/activeScan'
import { zapScopeContext } from '../../domain/crawlScope'
import { zapExcludeRegexes } from '../../domain/excludePaths'
import { joinUrl, restoreLoopbackHost, rewriteLoopbackHost } from '../../domain/hostAlias'
import { EngineError, OOM_RUNBOOK, type DiscoverRunner } from '../types'
import {
  BROWSER_STORAGE_SCRIPT_ENGINE,
  BROWSER_STORAGE_SCRIPT_FILE,
  BROWSER_STORAGE_SCRIPT_NAME,
  buildBrowserStorageScript,
} from './browserStorageScript'
import { buildZapDiscoverPlan, planToYaml } from './plan'
import { buildFirefoxPrefsConfig } from './firefoxPrefs'
import { buildReplacerConf } from './replacer'
import { runZap, zapPath } from './runZap'
import {
  buildSiteTreeDumpScript,
  historyTypeToSource,
  parseSiteTreeDump,
  SITE_TREE_DUMP_ENGINE,
  SITE_TREE_DUMP_OUTPUT_FILE,
  SITE_TREE_DUMP_SCRIPT_FILE,
  SITE_TREE_DUMP_SCRIPT_NAME,
} from './siteTreeDump'
import { crawlScopePrefixes } from '#shared/utils/crawlScope'
import { resolveDiscoverySeeds } from '#shared/utils/seedPaths'

/**
 * Discovery = ZAP's traditional + Ajax spiders from the site's seed path,
 * with every passive rule off, followed by a script that dumps the site
 * tree. Unlike zap-fe's `reachedUrls` (which only lists URIs that produced
 * an alert) this is every URL the crawl actually requested.
 */
export const runZapDiscover: DiscoverRunner = async ({
  discoveryId,
  site,
  workDir,
  env,
  logger,
  signal,
}) => {
  const alias = env.zap.localhostAlias
  const originalHost = new URL(site.frontBaseUrl).hostname
  const unalias = (u: string) => restoreLoopbackHost(u, alias, originalHost)
  const front = rewriteLoopbackHost(site.frontBaseUrl + '/', alias).replace(/\/$/, '')
  const api = site.apiBaseUrl
    ? rewriteLoopbackHost(site.apiBaseUrl + '/', alias).replace(/\/$/, '')
    : null
  const seedPaths = resolveDiscoverySeeds(site)
  const seedUrls = seedPaths.map((p) => joinUrl(front, p))
  const excludeRegexes = zapExcludeRegexes(site.excludePaths)
  const origins = [front, ...(api ? [api] : [])]
  // Both origins whole, or — with a crawl scope — the prefixes on the
  // front, the API subtree and the seeds themselves (see domain/crawlScope).
  const scope = zapScopeContext({
    seedUrls,
    front,
    api,
    prefixes: crawlScopePrefixes(site.crawlScopePaths),
  })
  const hasBrowserStorage = site.browserStorage.length > 0
  const plan = buildZapDiscoverPlan({
    context: { name: 'sakuda', ...scope, excludePaths: excludeRegexes },
    seedUrls,
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
    scriptFile: zapPath(env, workDir, SITE_TREE_DUMP_SCRIPT_FILE),
    scriptName: SITE_TREE_DUMP_SCRIPT_NAME,
    scriptEngine: SITE_TREE_DUMP_ENGINE,
    // Active discovery: submit forms as POST during the crawl only when the
    // site opted into active checks (a passive discovery stays GET-only).
    postForms: isActiveScanEnabled(site),
    // Client Spider (#70) observes form-driven non-GET requests; form
    // submission is mutating, so it rides the same active-checks gate.
    clientSpider: isActiveScanEnabled(site),
  })
  logger.info(
    {
      discoveryId,
      seedPaths,
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      headerNames: site.headerNames,
      browserStorageNames: site.browserStorageNames,
    },
    'discovery start',
  )
  // One traditional spider + one Ajax spider per seed, plus (under active
  // checks) one Client Spider per seed — each bounded by the site's limit.
  const clientSpider = isActiveScanEnabled(site)
  const spiderRuns = 1 + seedUrls.length + (clientSpider ? seedUrls.length : 0)
  const timeoutMs = (site.zapFeSpiderMaxMinutes * spiderRuns + env.engineGraceMinutes) * 60_000
  const run = await runZap({
    label: `discover:${discoveryId}`,
    env,
    workDir,
    planYaml: planToYaml(plan),
    replacerConf: site.headers.length ? buildReplacerConf(site.headers) : null,
    config: buildFirefoxPrefsConfig(alias),
    extraFiles: {
      [SITE_TREE_DUMP_SCRIPT_FILE]: buildSiteTreeDumpScript(
        zapPath(env, workDir, SITE_TREE_DUMP_OUTPUT_FILE),
      ),
    },
    ...(hasBrowserStorage
      ? {
          secretFiles: {
            [BROWSER_STORAGE_SCRIPT_FILE]: buildBrowserStorageScript(site.browserStorage, origins),
          },
        }
      : {}),
    reportFile: SITE_TREE_DUMP_OUTPUT_FILE,
    timeoutMs,
    signal,
    logger,
  })
  if (run.result.aborted) throw new EngineError('discovery aborted: server shutting down')
  if (run.reportText === null)
    throw new EngineError(
      `discovery produced no ${SITE_TREE_DUMP_OUTPUT_FILE} (exit ${run.result.code ?? 'null'}, signal ${run.result.signal ?? 'none'}${run.result.timedOut ? ', timed out' : ''}); the ZAP script job may have failed — see ${join(workDir, 'stdout.log')}`,
      run.result.oomKilled ? OOM_RUNBOOK : undefined,
    )
  const dump = parseSiteTreeDump(run.reportText)
  const { kept, dropped } = normalizeCrawledEntries(site, dump.entries, (e) => unalias(e.url), {
    dedupeKeyOf: (e, url) => crawledUrlKey(e.method, url),
  })
  const urls = kept.map(({ url, entry }) => ({
    url,
    method: entry.method,
    statusCode: entry.status,
    source: historyTypeToSource(entry.type),
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
    ...(entry.bodyShape ? { bodyShape: entry.bodyShape } : {}),
  }))
  const bodyShapeCount = urls.filter((u) => u.bodyShape).length
  const authFailureCount = dump.entries.filter((e) => e.status === 401 || e.status === 403).length
  // Ajax-spider entries only — the ones a running SPA would have produced.
  const ajaxEntries = dump.entries.filter((e) => historyTypeToSource(e.type) === 'ajax')
  const warnings: string[] = []
  if (dump.entries.length === 0)
    warnings.push(
      'the crawl requested no URLs — verify the target is reachable from ZAP and the seed path is right',
    )
  if (spaLikelyDidNotStart(ajaxEntries))
    warnings.push(
      'the Ajax spider ran but the app made no client-side API calls — the SPA likely did not start or is still anonymous. Check: the secure-context alias, the browser-storage login values, and that the app JS (e.g. /_nuxt/*) is not in excludePaths',
    )
  if (authFailureCount > 0)
    warnings.push(`${authFailureCount} request(s) got 401/403 — headers may be missing or expired`)
  if (run.result.timedOut)
    warnings.push('ZAP was stopped by the engine timeout; the URL list may be partial')
  if (dump.invalidLines > 0)
    warnings.push(`${dump.invalidLines} unparsable line(s) in the site-tree dump were ignored`)
  // Counts only: discovered URLs may carry query strings with sensitive values,
  // and a body shape's field names are API structure — log how many, never which.
  logger.info(
    { discoveryId, nodeCount: dump.entries.length, urlCount: urls.length, bodyShapeCount, dropped },
    'discovery done',
  )
  return {
    urls,
    warnings,
    exitCode: run.result.code,
    signal: run.result.signal,
    meta: {
      seedUrls: seedPaths.map((p) => joinUrl(site.frontBaseUrl, p)),
      browserStorage: site.browserStorageNames.map((n) => `${n.kind}:${n.name}`),
      spider: clientSpider ? 'traditional + ajax + client' : 'traditional + ajax',
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      nodeCount: dump.entries.length + dump.structuralCount,
      structuralCount: dump.structuralCount,
      urlCount: urls.length,
      bodyShapeCount,
      dropped,
      authFailureCount,
      ajaxApiCallCount: ajaxEntries.filter((e) => isApiCall(e.method, e.url)).length,
      excludeRegexes,
      durationSec: Math.round(run.result.durationMs / 1000),
      timedOut: run.result.timedOut,
    },
  }
}
