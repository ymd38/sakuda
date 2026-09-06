/**
 * Parses the site's optional crawl-scope list: one path prefix per line
 * (`/app`, `/rest`), `#`-comments allowed, no query or fragment (a prefix
 * is a path, not a URL). A trailing slash is dropped (`/app/` ≡ `/app`)
 * except on the root. Duplicates are removed.
 *
 * The seed paths are start points; this list is the *range* a crawl may
 * follow. Empty (or containing `/`) means the whole origin, exactly as
 * before the field existed — see `server/domain/crawlScope` for the
 * effective semantics.
 */
export function parseCrawlScopeLines(text: string): { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    if (!/^\/[^\s?#]*$/.test(line)) {
      errors.push(
        `line ${i + 1}: must be a path prefix starting with "/" (no query or fragment), got "${line}"`,
      )
      return
    }
    const prefix = line.length > 1 ? line.replace(/\/+$/, '') : line
    if (seen.has(prefix)) return
    seen.add(prefix)
    lines.push(prefix)
  })
  return { lines, errors }
}

/** The prefixes that actually restrict a crawl: none when the list is empty
 * or names the root (`/` puts everything in scope, so nothing is narrowed). */
export function crawlScopePrefixes(text: string): string[] {
  const { lines } = parseCrawlScopeLines(text)
  return lines.includes('/') ? [] : lines
}
