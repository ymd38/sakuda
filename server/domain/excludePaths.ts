export function parseExcludePatterns(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function globBody(pattern: string): string {
  return pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
}

export function globToPathRegexSource(pattern: string): string {
  return `^${globBody(pattern)}$`
}

export function pathMatchesAny(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(globToPathRegexSource(p)).test(pathname))
}

export function toZapExcludeRegex(pattern: string): string {
  return `^https?://[^/]+${globBody(pattern)}(\\?.*)?$`
}

/**
 * Paths no scanner should spend time on, whatever the site configured. The
 * single source of truth for both sides of the pipeline: the discovered-URL
 * filter (see `crawledUrls`) drops them from the target set, and
 * {@link zapExcludeRegexes} keeps them out of ZAP's context so spider and
 * active scan never queue them.
 *
 * socket.io: every long-poll round-trip is a fresh, ephemeral URL. Excluding
 * it from discovery alone is not enough — left in the ZAP context, the active
 * scan stalls ~30s per rule on a transport that answers nothing (found while
 * verifying #17 against Juice Shop).
 */
export const SCAN_NOISE_GLOBS = ['/socket.io*']

/** The ZAP context's exclude regexes for a site: what the user configured,
 * plus {@link SCAN_NOISE_GLOBS}, which is never optional. Deduped so a site
 * that already lists a noise glob does not double it in the plan. */
export function zapExcludeRegexes(excludePaths: string): string[] {
  const patterns = [...parseExcludePatterns(excludePaths), ...SCAN_NOISE_GLOBS]
  return [...new Set(patterns.map(toZapExcludeRegex))]
}
