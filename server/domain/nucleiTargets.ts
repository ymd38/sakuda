import { parseNucleiPathLines, type TargetMethod } from '#shared/utils/nucleiPaths'
import { parseExcludePatterns, pathMatchesAny } from './excludePaths'
import { joinUrl } from './hostAlias'

export interface NucleiTargetSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
  nucleiPaths: string
  excludePaths: string
}

/** Per-method count of saved lines an engine did not replay. Counts only —
 * never the path/query/body, which may hold secrets (Epic #41). Each engine
 * adapter builds this itself, over its own scope, from the typed targets. */
export type SkippedMethods = Partial<Record<TargetMethod, number>>

/** One resolved saved target: its method and the absolute URL, plus which
 * base it came from (`front`/`api`) so an adapter can scope by base without
 * re-deriving it from the origin — front and api may share an origin. */
export interface ExpandedTarget {
  method: TargetMethod
  base: 'front' | 'api'
  url: string
}

export interface ExpandedNucleiTargets {
  /** Every saved target, all methods, exclusion applied. The single seam the
   * engine adapters read: nuclei replays the GET ones now and (PR3) feeds the
   * non-GET ones through a generated OpenAPI; the ZAP requestor (PR4) will
   * send the non-GET ones as structured requests. */
  targets: ExpandedTarget[]
  /** Absolute URLs dropped by the site's exclude paths — GET only. A non-GET
   * line that also matches an exclude pattern is dropped silently and never
   * listed here, so an excluded path is not exposed for a method nothing
   * replays yet (Epic #41). */
  excluded: string[]
  /** False when the site has no saved lines and `targets` is the root fallback. */
  configured: boolean
}

/** Builds `skippedMethods` from the non-GET members of a target list — the
 * per-adapter helper each engine calls after applying its own scope, so the
 * count reflects what *that* engine chose not to replay. */
export function countSkippedMethods(targets: ExpandedTarget[]): SkippedMethods {
  const skipped: SkippedMethods = {}
  for (const t of targets) if (t.method !== 'GET') skipped[t.method] = (skipped[t.method] ?? 0) + 1
  return skipped
}

/** Resolves the site's saved target lines (`nucleiPaths`) to typed targets.
 * This is the one target source discovery writes into (`discoveryService`)
 * once the user approves URLs, so every engine reads exactly the saved list.
 *
 * Every method is kept (the caller decides what it replays); a line matching
 * an exclude pattern is dropped. Dedupe identity is method+base+url, so a
 * `POST /x` never hides a `GET /x`. */
export function expandNucleiTargets(site: NucleiTargetSite): ExpandedNucleiTargets {
  const parsed = parseNucleiPathLines(site.nucleiPaths)
  // No paths configured → scan the base URL(s) themselves. Nuclei is
  // signature-based and does not crawl, so the roots are the minimum useful
  // target set (exposure / misconfig / tech templates work on them).
  const lines =
    parsed.lines.length > 0
      ? parsed.lines
      : [
          { lineNo: 0, method: 'GET' as const, base: 'front' as const, path: '/' },
          ...(site.apiBaseUrl
            ? [{ lineNo: 0, method: 'GET' as const, base: 'api' as const, path: '/' }]
            : []),
        ]
  const patterns = parseExcludePatterns(site.excludePaths)
  const targets: ExpandedTarget[] = []
  const excluded: string[] = []
  const seen = new Set<string>()
  for (const l of lines) {
    const baseUrl = l.base === 'api' ? site.apiBaseUrl : site.frontBaseUrl
    if (!baseUrl) continue // schema already rejects api: lines without apiBaseUrl
    const url = joinUrl(baseUrl, l.path)
    const key = `${l.method}|${l.base}|${url}`
    if (seen.has(key)) continue
    seen.add(key)
    if (pathMatchesAny(new URL(url).pathname, patterns)) {
      // Only surface an excluded URL for a method something replays (GET);
      // a non-GET excluded line is dropped without exposing its path.
      if (l.method === 'GET') excluded.push(url)
      continue
    }
    targets.push({ method: l.method, base: l.base, url })
  }
  return { targets, excluded, configured: parsed.lines.length > 0 }
}

/**
 * The saved targets ZAP FE requests up front (AF `requestor` job) so URLs
 * the spider never reaches — a history-mode SPA's `/search?q=` — still land
 * in the site tree for the passive and active scans. Same expansion and
 * exclusion as nuclei (one source of truth), narrowed to what the FE plan
 * can act on: front-base targets only (`api:` lines belong to zap-api's
 * context — scoped by `base`, not origin, since front and api may share
 * one), GET only (non-GET replay is PR4), and no hash routes — the fragment
 * never reaches the server, so requesting `/#/search?q=` is just another GET
 * of `/` (their DOM probing is a separate concern). No saved lines → no
 * requestor job at all: the root fallback nuclei uses is already the seed.
 */
export function zapFeRequestTargets(expanded: ExpandedNucleiTargets): string[] {
  if (!expanded.configured) return []
  return expanded.targets
    .filter((t) => t.base === 'front' && t.method === 'GET' && !t.url.includes('#'))
    .map((t) => t.url)
}

/**
 * The saved front-base GET targets that ARE hash routes (`/#/search?q=`) —
 * the exact complement of {@link zapFeRequestTargets} within the front base.
 * The fragment never reaches the server, so ZAP's spider/requestor/activeScan
 * cannot test these; the headless DOM XSS probe (see `domXssProbeScript`)
 * opens each in a real browser instead. `api:` lines and non-GET lines are
 * dropped. No saved lines → none.
 */
export function zapFeHashRouteTargets(expanded: ExpandedNucleiTargets): string[] {
  if (!expanded.configured) return []
  return expanded.targets
    .filter((t) => t.base === 'front' && t.method === 'GET' && t.url.includes('#'))
    .map((t) => t.url)
}
