import { parseExcludePatterns, pathMatchesAny } from './excludePaths'

/** The subset of a site a crawl result is filtered against. */
export interface CrawlScopeSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
  excludePaths: string
}

const ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.webp',
  '.mp4',
  '.pdf',
])

const DEV_NOISE_PREFIXES = ['/_nuxt/', '/@fs/', '/@vite/', '/node_modules/']

/** Paths a crawler picks up that are never worth a scanner's time:
 * socket.io transport endpoints (one URL per polling round-trip, all
 * ephemeral) and "paths" that are really stack-trace locations scraped out
 * of an error page body (`/build/routes/fileServer.js:69:18`). */
const NOISE_PREFIXES = ['/socket.io/', '/socket.io']
const STACK_TRACE_SUFFIX = /:\d+:\d+$/

function isAsset(pathname: string): boolean {
  const lower = pathname.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot !== -1 && ASSET_EXTENSIONS.has(lower.slice(dot))) return true
  return DEV_NOISE_PREFIXES.some((p) => lower.includes(p))
}

/** Path segments that mark a request as an app-initiated API call. */
const API_PATH_MARKERS = /\/(api|rest|graphql)(\/|$)/

/**
 * Heuristic for "the running app fetched this from its own backend" — an
 * XHR/fetch rather than a document navigation or an asset. Used to tell
 * whether a SPA actually started (see {@link spaLikelyDidNotStart}); it reads
 * only the method and URL, never a response body.
 *
 * Biased toward *missing* an API rather than a false alarm: only clear signals
 * count (a non-GET method, an `/api`|`/rest`|`/graphql` segment, or a `.json`
 * path). A plain GET without one of those — `/about`, and even `/about?ref=x`
 * — is treated as an HTML navigation, not an API, so a crawl that only moved
 * between pages still triggers the warning. (A query string alone is not a
 * signal: page navigations carry them too, and counting one as an API call
 * would wrongly suppress the warning.) An unparsable URL is not an API call.
 */
export function isApiCall(method: string, url: string): boolean {
  if (!URL.canParse(url)) return false
  const u = new URL(url)
  if (isAsset(u.pathname)) return false
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') return true
  const lower = u.pathname.toLowerCase()
  if (API_PATH_MARKERS.test(lower)) return true
  if (lower.endsWith('.json')) return true
  return false
}

/**
 * True when the Ajax spider ran (there are Ajax-sourced entries) but the app
 * made no client-side API call — the SPA likely never booted or is still
 * anonymous, which otherwise looks like a clean, empty-of-findings crawl.
 * Returns false when there are no Ajax entries at all: that is a different
 * situation (the browser never crawled) already covered by other warnings, and
 * we do not want to duplicate it.
 */
export function spaLikelyDidNotStart(
  ajaxEntries: ReadonlyArray<{ method: string; url: string }>,
): boolean {
  if (ajaxEntries.length === 0) return false
  return !ajaxEntries.some((e) => isApiCall(e.method, e.url))
}

function isNoise(pathname: string): boolean {
  const lower = pathname.toLowerCase()
  return (
    NOISE_PREFIXES.some((p) => lower === p || lower.startsWith(p)) || STACK_TRACE_SUFFIX.test(lower)
  )
}

export type CrawledUrlDropReason = 'invalid' | 'sameOriginOnly' | 'asset' | 'noise' | 'excluded'

export type CrawledUrlClassification =
  { kind: 'ok'; url: string } | { kind: 'dropped'; reason: CrawledUrlDropReason }

function allowedOrigins(site: CrawlScopeSite): Set<string> {
  return new Set(
    [site.frontBaseUrl, site.apiBaseUrl]
      .filter((u): u is string => !!u)
      .map((u) => new URL(u).origin),
  )
}

/** Decides whether one crawler-discovered URL belongs in the site's target
 * set. Fragments are stripped (they never reach the server). Never throws —
 * an unparsable URL is classified as dropped rather than propagated. */
export function classifyCrawledUrl(
  site: CrawlScopeSite,
  raw: string,
  patterns: string[] = parseExcludePatterns(site.excludePaths),
): CrawledUrlClassification {
  if (!URL.canParse(raw)) return { kind: 'dropped', reason: 'invalid' }
  const u = new URL(raw)
  u.hash = ''
  if (!allowedOrigins(site).has(u.origin)) return { kind: 'dropped', reason: 'sameOriginOnly' }
  if (isAsset(u.pathname)) return { kind: 'dropped', reason: 'asset' }
  if (isNoise(u.pathname)) return { kind: 'dropped', reason: 'noise' }
  if (pathMatchesAny(u.pathname, patterns)) return { kind: 'dropped', reason: 'excluded' }
  return { kind: 'ok', url: u.toString() }
}

export interface CrawledUrlsDropped extends Record<CrawledUrlDropReason, number> {
  /** Beyond `maxUrls` accepted URLs. */
  capped: number
}

export const emptyCrawledUrlsDropped = (): CrawledUrlsDropped => ({
  invalid: 0,
  sameOriginOnly: 0,
  asset: 0,
  noise: 0,
  excluded: 0,
  capped: 0,
})

export const DEFAULT_MAX_DISCOVERED_URLS = 500

export interface NormalizeCrawledOptions {
  maxUrls?: number
}

/** Filters, dedupes (first occurrence wins, crawl order preserved) and caps
 * a crawler's raw entries, keeping each surviving entry next to its
 * normalized URL. `dropped` carries a per-reason count so the caller can
 * show *why* a crawl of N nodes became M targets. */
export function normalizeCrawledEntries<T>(
  site: CrawlScopeSite,
  entries: T[],
  urlOf: (entry: T) => string,
  opts?: NormalizeCrawledOptions,
): { kept: Array<{ url: string; entry: T }>; dropped: CrawledUrlsDropped } {
  const maxUrls = opts?.maxUrls ?? DEFAULT_MAX_DISCOVERED_URLS
  const patterns = parseExcludePatterns(site.excludePaths)
  const dropped = emptyCrawledUrlsDropped()
  const seen = new Set<string>()
  const kept: Array<{ url: string; entry: T }> = []
  for (const entry of entries) {
    const c = classifyCrawledUrl(site, urlOf(entry), patterns)
    if (c.kind === 'dropped') {
      dropped[c.reason]++
      continue
    }
    if (seen.has(c.url)) continue
    seen.add(c.url)
    if (kept.length >= maxUrls) {
      dropped.capped++
      continue
    }
    kept.push({ url: c.url, entry })
  }
  return { kept, dropped }
}

/** String-only convenience over {@link normalizeCrawledEntries}. */
export function normalizeCrawledUrls(
  site: CrawlScopeSite,
  raw: string[],
  opts?: NormalizeCrawledOptions,
): { urls: string[]; dropped: CrawledUrlsDropped } {
  const { kept, dropped } = normalizeCrawledEntries(site, raw, (u) => u, opts)
  return { urls: kept.map((k) => k.url), dropped }
}
