/** Parses the site's multi-line discovery seed list: one path per line
 * (`/`, `/#/search?q=apple`, `/profile`), `#`-comments allowed, duplicates
 * removed. Same per-line rule as `zapFeSeedPath`. */
export function parseSeedPathLines(text: string): { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    if (!/^\/\S*$/.test(line)) {
      errors.push(`line ${i + 1}: must be a path starting with "/", got "${line}"`)
      return
    }
    if (seen.has(line)) return
    seen.add(line)
    lines.push(line)
  })
  return { lines, errors }
}

/** The seeds a discovery crawls from — one of two, never both: the listed
 * routes when any are configured ("From listed routes" in the form), else
 * the zap-fe seed path ("From the seed path"). The choice is not stored;
 * the list being empty or not is the choice, so an existing site keeps
 * behaving exactly as before the field existed. */
export function resolveDiscoverySeeds(site: {
  discoverySeedPaths: string
  zapFeSeedPath: string
}): string[] {
  const { lines } = parseSeedPathLines(site.discoverySeedPaths)
  return lines.length > 0 ? lines : [site.zapFeSeedPath]
}
