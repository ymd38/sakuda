import { crawledUrlKey, normalizeCrawledEntries, type CrawlScopeSite } from '../domain/crawledUrls'
import { runKatanaCrawl } from './katana'
import type { DiscoverOutput, DiscoverRunner } from './types'
import { runZapDiscover } from './zap/zapDiscover'

export interface DiscoverSources {
  zap: DiscoverRunner
  katana: DiscoverRunner
}

/**
 * The discovery job: ZAP's spiders and katana's static crawl in parallel,
 * merged into one URL list. ZAP is the primary source — its failure fails
 * the discovery as before — while a katana failure (binary missing, timeout,
 * non-zero exit) only costs a warning, so the ZAP result is never lost to it.
 */
export function createDiscoverRunner(sources: DiscoverSources): DiscoverRunner {
  return async (input) => {
    const [zapResult, katanaResult] = await Promise.allSettled([
      sources.zap(input),
      sources.katana(input),
    ])
    if (zapResult.status === 'rejected') throw zapResult.reason
    return mergeDiscoverOutputs(input.site, zapResult.value, katanaResult)
  }
}

export function mergeDiscoverOutputs(
  site: CrawlScopeSite,
  zap: DiscoverOutput,
  katana: PromiseSettledResult<DiscoverOutput>,
): DiscoverOutput {
  if (katana.status === 'rejected') {
    const message = katana.reason instanceof Error ? katana.reason.message : String(katana.reason)
    return {
      ...zap,
      warnings: [...zap.warnings, `katana crawl failed (ZAP results kept): ${message}`],
      meta: { ...zap.meta, katana: { error: message } },
    }
  }
  // Both lists are already normalized; running the shared pass once more is
  // idempotent and gives cross-source dedupe (ZAP first, so its entry wins)
  // plus a single overall cap.
  const combined = [...zap.urls, ...katana.value.urls]
  const { kept, dropped } = normalizeCrawledEntries(site, combined, (u) => u.url, {
    dedupeKeyOf: (u, url) => crawledUrlKey(u.method, url),
  })
  const urls = kept.map((k) => k.entry)
  const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0)
  const duplicates = combined.length - urls.length - droppedTotal
  return {
    urls,
    warnings: [...zap.warnings, ...katana.value.warnings],
    exitCode: zap.exitCode,
    signal: zap.signal,
    meta: {
      ...zap.meta,
      urlCount: urls.length,
      katana: katana.value.meta,
      merged: { urlCount: urls.length, duplicates, capped: dropped.capped },
    },
  }
}

export const runDiscover: DiscoverRunner = createDiscoverRunner({
  zap: runZapDiscover,
  katana: runKatanaCrawl,
})
