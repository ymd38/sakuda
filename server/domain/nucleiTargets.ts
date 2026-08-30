import { parseNucleiPathLines } from '#shared/utils/nucleiPaths'
import { parseExcludePatterns, pathMatchesAny } from './excludePaths'
import { joinUrl } from './hostAlias'

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

function isAssetOrDevNoise(pathname: string): boolean {
  const lower = pathname.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot !== -1 && ASSET_EXTENSIONS.has(lower.slice(dot))) return true
  return DEV_NOISE_PREFIXES.some((p) => lower.includes(p))
}

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

export interface MergeCrawledTargetsDropped {
  /** Not on the front or api base URL's origin. */
  sameOriginOnly: number
  /** Matched an excludePaths glob. */
  excluded: number
  /** Static asset (by extension) or dev-server noise (`/_nuxt/`, `/@vite/`, ...). */
  asset: number
  /** Beyond `maxCrawled` accepted crawled URLs. */
  capped: number
  /** Not parseable as a URL. */
  invalid: number
}

const DEFAULT_MAX_CRAWLED = 200

/** Filters and merges crawler-discovered URLs (e.g. zap-fe's spider) into the
 * nuclei target list. `base` is kept as-is and first in the result; `crawled`
 * entries are validated, filtered, deduped (against `base` and themselves)
 * and capped, preserving crawl order, and appended after `base`. Never
 * throws — an unparsable URL is dropped and counted rather than propagated. */
export function mergeCrawledTargets(
  site: NucleiTargetSite,
  base: string[],
  crawled: string[],
  opts?: { maxCrawled?: number },
): { urls: string[]; dropped: MergeCrawledTargetsDropped } {
  const maxCrawled = opts?.maxCrawled ?? DEFAULT_MAX_CRAWLED
  const allowedOrigins = new Set(
    [site.frontBaseUrl, site.apiBaseUrl]
      .filter((u): u is string => !!u)
      .map((u) => new URL(u).origin),
  )
  const patterns = parseExcludePatterns(site.excludePaths)
  const seen = new Set(base)
  const dropped: MergeCrawledTargetsDropped = {
    sameOriginOnly: 0,
    excluded: 0,
    asset: 0,
    capped: 0,
    invalid: 0,
  }
  const added: string[] = []
  for (const raw of crawled) {
    if (!URL.canParse(raw)) {
      dropped.invalid++
      continue
    }
    const u = new URL(raw)
    u.hash = ''
    if (!allowedOrigins.has(u.origin)) {
      dropped.sameOriginOnly++
      continue
    }
    if (isAssetOrDevNoise(u.pathname)) {
      dropped.asset++
      continue
    }
    if (pathMatchesAny(u.pathname, patterns)) {
      dropped.excluded++
      continue
    }
    const url = u.toString()
    if (seen.has(url)) continue
    seen.add(url)
    if (added.length >= maxCrawled) {
      dropped.capped++
      continue
    }
    added.push(url)
  }
  return { urls: [...base, ...added], dropped }
}
