import { parseNucleiPathLines } from '#shared/utils/nucleiPaths'
import { parseExcludePatterns, pathMatchesAny } from './excludePaths'
import { joinUrl } from './hostAlias'

export interface NucleiTargetSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
  nucleiPaths: string
  excludePaths: string
}

/** Resolves the site's saved target lines (`nucleiPaths`) to absolute URLs.
 * This is nuclei's only target source: discovery (see `discoveryService`)
 * writes into `nucleiPaths` once the user has approved the URLs, so what
 * nuclei scans is exactly what the site page lists as saved targets. */
export function expandNucleiTargets(site: NucleiTargetSite): {
  urls: string[]
  excluded: string[]
  /** False when the site has no saved lines and `urls` is the root fallback. */
  configured: boolean
} {
  const parsed = parseNucleiPathLines(site.nucleiPaths)
  // No paths configured → scan the base URL(s) themselves. Nuclei is
  // signature-based and does not crawl, so the roots are the minimum useful
  // target set (exposure / misconfig / tech templates work on them).
  const lines =
    parsed.lines.length > 0
      ? parsed.lines
      : [
          { lineNo: 0, base: 'front' as const, path: '/' },
          ...(site.apiBaseUrl ? [{ lineNo: 0, base: 'api' as const, path: '/' }] : []),
        ]
  const patterns = parseExcludePatterns(site.excludePaths)
  const urls: string[] = []
  const excluded: string[] = []
  const seen = new Set<string>()
  for (const l of lines) {
    const base = l.base === 'api' ? site.apiBaseUrl : site.frontBaseUrl
    if (!base) continue // schema already rejects api: lines without apiBaseUrl
    const url = joinUrl(base, l.path)
    if (seen.has(url)) continue
    seen.add(url)
    if (pathMatchesAny(new URL(url).pathname, patterns)) excluded.push(url)
    else urls.push(url)
  }
  return { urls, excluded, configured: parsed.lines.length > 0 }
}

/**
 * The saved targets ZAP FE requests up front (AF `requestor` job) so URLs
 * the spider never reaches — a history-mode SPA's `/search?q=` — still land
 * in the site tree for the passive and active scans. Same expansion and
 * exclusion as nuclei (one source of truth), narrowed to what the FE plan
 * can act on: the front origin only (`api:` lines belong to zap-api's
 * context), and no hash routes — the fragment never reaches the server, so
 * requesting `/#/search?q=` is just another GET of `/` (their DOM probing is
 * a separate concern). No saved lines → no requestor job at all: the root
 * fallback nuclei uses is already the spider's seed.
 */
export function zapFeRequestTargets(site: NucleiTargetSite): string[] {
  const { urls, configured } = expandNucleiTargets(site)
  if (!configured) return []
  const frontOrigin = new URL(site.frontBaseUrl).origin
  return urls.filter((u) => !u.includes('#') && new URL(u).origin === frontOrigin)
}

/**
 * The saved front-origin targets that ARE hash routes (`/#/search?q=`) — the
 * exact complement of {@link zapFeRequestTargets} within the front origin.
 * The fragment never reaches the server, so ZAP's spider/requestor/activeScan
 * cannot test these; the headless DOM XSS probe (see `domXssProbeScript`)
 * opens each in a real browser instead. `api:` lines resolve to the API
 * origin and are dropped. No saved lines → none.
 */
export function zapFeHashRouteTargets(site: NucleiTargetSite): string[] {
  const { urls, configured } = expandNucleiTargets(site)
  if (!configured) return []
  const frontOrigin = new URL(site.frontBaseUrl).origin
  return urls.filter((u) => u.includes('#') && new URL(u).origin === frontOrigin)
}
