import type { Engine, EngineRunView } from '#shared/types/api'
import {
  code,
  fmtDuration,
  metaBoolean,
  metaNumber,
  metaRecord,
  metaString,
  metaStringArray,
  text,
} from './markdownReport'

/** Renders the `| Item | Value |` metadata table for one engine run: the
 * generic exit/duration rows shared by every engine, followed by rows built
 * from the engine-specific `meta` fields each engine writes (see
 * server/engines/{nuclei,zap}/*). */
export function engineMetaTable(run: EngineRunView): string[] {
  const rows = ['| Item | Value |', '|---|---|', `| Exit code | ${run.exitCode ?? '—'} |`]
  if (run.signal) rows.push(`| Signal | ${text(run.signal)} |`)
  rows.push(`| Duration | ${fmtDuration(metaNumber(run.meta, 'durationSec'))} |`)
  if (metaBoolean(run.meta, 'timedOut')) rows.push('| Timed out | Yes |')
  rows.push(...engineSpecificRows(run.engine, run.meta))
  return rows
}

function engineSpecificRows(engine: Engine, meta: Record<string, unknown>): string[] {
  switch (engine) {
    case 'nuclei':
      return nucleiRows(meta)
    case 'zap-fe':
      return zapRows(meta, true)
    case 'zap-api':
      return zapRows(meta, false)
    default: {
      const exhaustive: never = engine
      return exhaustive
    }
  }
}

function nucleiRows(meta: Record<string, unknown>): string[] {
  const rows: string[] = []
  const urlCount = metaNumber(meta, 'urlCount')
  if (urlCount !== undefined) rows.push(`| Target URLs | ${urlCount} |`)
  const excludedUrls = metaStringArray(meta, 'excludedUrls')
  if (excludedUrls) rows.push(`| Excluded URLs | ${excludedUrls.length} |`)
  const tags = metaString(meta, 'tags')
  if (tags) rows.push(`| Tags | ${code(tags)} |`)
  const rateLimit = metaNumber(meta, 'rateLimit')
  if (rateLimit !== undefined) rows.push(`| Rate limit | ${rateLimit} req/s |`)
  const concurrency = metaNumber(meta, 'concurrency')
  if (concurrency !== undefined) rows.push(`| Concurrency | ${concurrency} |`)
  const stats = metaRecord(meta, 'stats')
  if (stats) {
    const templates = metaString(stats, 'templates')
    if (templates) rows.push(`| Templates scanned | ${text(templates)} |`)
    const requests = metaString(stats, 'requests')
    if (requests) rows.push(`| Requests sent | ${text(requests)} |`)
    const errors = metaString(stats, 'errors')
    if (errors) rows.push(`| Errors | ${text(errors)} |`)
    const rps = metaString(stats, 'rps')
    if (rps) rows.push(`| Avg RPS | ${text(rps)} |`)
  }
  return rows
}

function zapRows(meta: Record<string, unknown>, isFrontend: boolean): string[] {
  const rows: string[] = []
  const zapVersion = metaString(meta, 'zapVersion')
  if (zapVersion) rows.push(`| ZAP version | ${text(zapVersion)} |`)
  if (isFrontend) {
    const seedUrl = metaString(meta, 'seedUrl')
    if (seedUrl) rows.push(`| Seed URL | ${code(seedUrl)} |`)
    const spider = metaString(meta, 'spider')
    if (spider) rows.push(`| Spider | ${text(spider)} |`)
    const spiderMaxMinutes = metaNumber(meta, 'spiderMaxMinutes')
    if (spiderMaxMinutes !== undefined) rows.push(`| Spider max minutes | ${spiderMaxMinutes} |`)
  } else {
    const targetUrl = metaString(meta, 'targetUrl')
    if (targetUrl) rows.push(`| Target URL | ${code(targetUrl)} |`)
    const openapiSource = metaString(meta, 'openapiSource')
    if (openapiSource) rows.push(`| OpenAPI source | ${text(openapiSource)} |`)
    const maxScanMinutes = metaNumber(meta, 'maxScanMinutes')
    if (maxScanMinutes !== undefined) rows.push(`| Max scan minutes | ${maxScanMinutes} |`)
  }
  const reachedUrlCount = metaNumber(meta, 'reachedUrlCount')
  if (reachedUrlCount !== undefined) rows.push(`| Reached URLs | ${reachedUrlCount} |`)
  const authFailureCount = metaNumber(meta, 'authFailureCount')
  if (authFailureCount !== undefined) rows.push(`| Auth failures (401/403) | ${authFailureCount} |`)
  const alertCounts = metaRecord(meta, 'alertCounts')
  if (alertCounts) {
    const low = metaNumber(alertCounts, 'low')
    const info = metaNumber(alertCounts, 'info')
    if (low !== undefined || info !== undefined)
      rows.push(`| Low / Info (not detailed) | ${low ?? 0} / ${info ?? 0} |`)
  }
  const excludeRegexes = metaStringArray(meta, 'excludeRegexes')
  if (excludeRegexes) rows.push(`| Exclude regexes | ${excludeRegexes.length} |`)
  return rows
}
