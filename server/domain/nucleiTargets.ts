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
  return { urls, excluded }
}
