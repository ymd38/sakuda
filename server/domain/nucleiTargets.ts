import { parseNucleiPathLines } from '#shared/utils/nucleiPaths'
import { parseExcludePatterns, pathMatchesAny } from './excludePaths'
import { joinUrl } from './hostAlias'

export interface NucleiTargetSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
  nucleiPaths: string
  excludePaths: string
}

export function expandNucleiTargets(site: NucleiTargetSite): {
  urls: string[]
  excluded: string[]
} {
  const { lines } = parseNucleiPathLines(site.nucleiPaths)
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
