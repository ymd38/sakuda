import { join } from 'node:path'
import { normalizeCrawledEntries } from '../../domain/crawledUrls'
import { escapeRegex, parseExcludePatterns, toZapExcludeRegex } from '../../domain/excludePaths'
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
  const excludeRegexes = parseExcludePatterns(site.excludePaths).map(toZapExcludeRegex)
  const origins = [front, ...(api ? [api] : [])]
  const hasBrowserStorage = site.browserStorage.length > 0
  const plan = buildZapDiscoverPlan({
    context: {
      name: 'sakuda',
      urls: seedUrls,
      includePaths: origins.map((b) => `^${escapeRegex(b)}(/.*)?$`),
      excludePaths: excludeRegexes,
    },
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
  // One traditional spider + one Ajax spider per seed, each bounded by the site's limit.
  const timeoutMs =
    (site.zapFeSpiderMaxMinutes * (1 + seedUrls.length) + env.engineGraceMinutes) * 60_000
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
  const { kept, dropped } = normalizeCrawledEntries(site, dump.entries, (e) => unalias(e.url))
  const urls = kept.map(({ url, entry }) => ({
    url,
    method: entry.method,
    statusCode: entry.status,
    source: historyTypeToSource(entry.type),
  }))
  const authFailureCount = dump.entries.filter((e) => e.status === 401 || e.status === 403).length
  const warnings: string[] = []
  if (dump.entries.length === 0)
    warnings.push(
      'the crawl requested no URLs — verify the target is reachable from ZAP and the seed path is right',
    )
  if (authFailureCount > 0)
    warnings.push(`${authFailureCount} request(s) got 401/403 — headers may be missing or expired`)
  if (run.result.timedOut)
    warnings.push('ZAP was stopped by the engine timeout; the URL list may be partial')
  if (dump.invalidLines > 0)
    warnings.push(`${dump.invalidLines} unparsable line(s) in the site-tree dump were ignored`)
  // Counts only: discovered URLs may carry query strings with sensitive values.
  logger.info(
    { discoveryId, nodeCount: dump.entries.length, urlCount: urls.length, dropped },
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
      spider: 'traditional + ajax',
      spiderMaxMinutes: site.zapFeSpiderMaxMinutes,
      nodeCount: dump.entries.length + dump.structuralCount,
      structuralCount: dump.structuralCount,
      urlCount: urls.length,
      dropped,
      authFailureCount,
      excludeRegexes,
      durationSec: Math.round(run.result.durationMs / 1000),
      timedOut: run.result.timedOut,
    },
  }
}
