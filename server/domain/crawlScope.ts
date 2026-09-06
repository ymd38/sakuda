import { crawlScopePrefixes } from '#shared/utils/crawlScope'
import { resolveDiscoverySeeds } from '#shared/utils/seedPaths'
import { escapeRegex } from './excludePaths'
import { joinUrl } from './hostAlias'

/**
 * The effective crawl scope of a site (see `shared/utils/crawlScope` for the
 * field's line syntax). One definition for every consumer — ZAP's context,
 * katana's `-cs` and the discovered-URL filter — so they cannot disagree.
 *
 * A URL is in scope when the site sets no prefix (the whole origin, as
 * before), or when it is
 * - under a prefix on the front base: `/app` covers `/app`, `/app/x` and
 *   `/app?y`, never `/application`;
 * - in the `apiBaseUrl` subtree — the subtree, not the origin, so a same-
 *   origin API (`/api` next to `/app`) is covered without widening the front;
 * - one of the seed URLs itself (fragment dropped): a seed is the start point
 *   and is always allowed, but nothing is derived from it — its neighbours
 *   are not in scope just because the crawl started there.
 */
export interface CrawlScopeSiteFields {
  frontBaseUrl: string
  apiBaseUrl: string | null
  crawlScopePaths: string
  discoverySeedPaths: string
  zapFeSeedPath: string
}

export interface CrawlScope {
  /** Absolute scope roots (`<front><prefix>`, no trailing slash). */
  roots: string[]
  /** `apiBaseUrl` without a trailing slash, or null. */
  api: string | null
  /** Absolute seed URLs, fragment dropped. */
  seeds: string[]
}

/** Null when the site restricts nothing (no prefixes, or `/`). */
export function resolveCrawlScope(site: CrawlScopeSiteFields): CrawlScope | null {
  const prefixes = crawlScopePrefixes(site.crawlScopePaths)
  if (prefixes.length === 0) return null
  return {
    roots: prefixes.map((p) => joinUrl(site.frontBaseUrl, p)),
    api: site.apiBaseUrl ? site.apiBaseUrl.replace(/\/+$/, '') : null,
    // The discovery seeds only: this scope classifies discovery output, and
    // a seed is the start point of the engine that crawls from it. The
    // zap-fe seed is still the fallback when no discovery seed is set.
    seeds: [...new Set(resolveDiscoverySeeds(site))].map((p) =>
      withoutFragment(joinUrl(site.frontBaseUrl, p)),
    ),
  }
}

function withoutFragment(url: string): string {
  const u = new URL(url)
  u.hash = ''
  return u.toString()
}

/** `origin + pathname` with one trailing slash removed (except the root),
 * so `/app/` and `/app` are the same subtree root. */
function pathOf(u: URL): string {
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : u.pathname
  return u.origin + path
}

function underRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/')
}

export function isUrlInCrawlScope(scope: CrawlScope | null, url: string): boolean {
  if (scope === null) return true
  if (!URL.canParse(url)) return false
  const u = new URL(url)
  u.hash = ''
  const path = pathOf(u)
  if (scope.api !== null && underRoot(path, scope.api)) return true
  if (scope.seeds.some((s) => s === u.toString() || s === u.toString() + '/')) return true
  return scope.roots.some((r) => underRoot(path, r))
}

const originRegex = (base: string) => `^${escapeRegex(base)}(/.*)?$`
const subtreeRegex = (root: string) => `^${escapeRegex(root)}(/.*)?(\\?.*)?$`
/** The seed and nothing else — but with any fragment: ZAP's spider checks
 * its start URL against the context *with* the `#/…` (verified on 2.17.0:
 * "The starting URI does not belong to the context"), and katana matches
 * `-cs` against the seed as given. */
const seedRegex = (url: string) => `^${escapeRegex(url)}(#.*)?$`
/** Front-origin JS bundles, whatever the scope: they are what katana's
 * `-jc` parses for API paths, and an SPA's bundles rarely live under the
 * API prefix. ZAP needs no such rule — its Ajax spider ships an
 * "allowed resources" list (`.js`, `.css`) for the same reason. The bundles
 * themselves still count as `outOfScope`/`asset` in the URL list. */
const jsBundlesRegex = (front: string) => `^${escapeRegex(front + '/')}.*\\.m?js(\\?.*)?$`

export interface ZapScopeInput {
  /** Every seed URL the plan crawls from (alias-rewritten, may carry a fragment). */
  seedUrls: string[]
  /** Alias-rewritten front base, no trailing slash. */
  front: string
  /** Alias-rewritten api base (no trailing slash), or null when the plan
   * does not cover the API origin at all. */
  api: string | null
  prefixes: string[]
}

/**
 * The ZAP context (`urls` + `includePaths`) for a plan. Unrestricted: the
 * seeds are the context URLs and each origin is included whole — byte for
 * byte what the plans built before the scope field existed. Restricted: the
 * Automation Framework turns every context URL into an `<url>.*` include
 * regex (unescaped, verified against automation-beta-0.60.0), so the seeds
 * cannot stay there without re-opening the whole origin; the context URLs
 * become the scope roots (`<root>/`, a subset of the include regexes) and
 * the seeds are included as exact URLs (see `seedRegex`).
 */
export function zapScopeContext(i: ZapScopeInput): { urls: string[]; includePaths: string[] } {
  const apiOrigins = i.api ? [i.api] : []
  if (i.prefixes.length === 0)
    return { urls: i.seedUrls, includePaths: [i.front, ...apiOrigins].map(originRegex) }
  const roots = i.prefixes.map((p) => joinUrl(i.front, p))
  const seeds = [...new Set(i.seedUrls.map(withoutFragment))]
  return {
    urls: [...roots, ...apiOrigins].map((r) => r + '/'),
    includePaths: [
      ...roots.map(subtreeRegex),
      ...seeds.map(seedRegex),
      ...apiOrigins.map(originRegex),
    ],
  }
}

/**
 * katana `-cs` (crawl-scope) regexes, cumulative with its `-fs fqdn` host
 * scope in v1.7.0: the scope roots, the exact seeds and the front's JS
 * bundles (see `jsBundlesRegex`). Empty when the site restricts nothing, so
 * the argv is unchanged. katana only ever crawls the front host, hence no
 * api entry.
 */
export function katanaScopeRegexes(i: Omit<ZapScopeInput, 'api'>): string[] {
  if (i.prefixes.length === 0) return []
  const roots = i.prefixes.map((p) => joinUrl(i.front, p))
  const seeds = [...new Set(i.seedUrls.map(withoutFragment))]
  return [...roots.map(subtreeRegex), ...seeds.map(seedRegex), jsBundlesRegex(i.front)]
}
