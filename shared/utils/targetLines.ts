import { parseNucleiPathLines } from './nucleiPaths'

/** The site fields needed to turn an absolute URL back into a saved target
 * line (`/path?q=1` on the front base, `api:/path` on the api base). */
export interface TargetLineSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
}

/** Converts a discovered absolute URL into the relative line format stored
 * in `sites.nucleiPaths` (SPEC §3.1: targets are relative to the base
 * URLs so a port/host change never requires rewriting them). Returns null
 * for a URL on neither base origin. */
export function urlToTargetLine(site: TargetLineSite, url: string): string | null {
  if (!URL.canParse(url)) return null
  const u = new URL(url)
  const rel = `${u.pathname}${u.search}`
  if (u.origin === new URL(site.frontBaseUrl).origin) return rel
  if (site.apiBaseUrl && u.origin === new URL(site.apiBaseUrl).origin) return `api:${rel}`
  return null
}

const lineKey = (base: 'front' | 'api', path: string) => `${base}|${path}`

export interface MergeTargetLinesResult {
  /** The new `nucleiPaths` text: existing text (comments and all) followed by the added lines. */
  text: string
  added: string[]
  /** Lines already present (after normalization) — not added again. */
  skipped: string[]
  /** Lines that are not valid target lines; nothing is merged when non-empty. */
  invalid: string[]
}

/** Appends `lines` to the saved target text, skipping duplicates of lines
 * already present and of each other. Existing content is preserved verbatim
 * (a user's comments and ordering are theirs), so this is append-only. */
export function mergeTargetLines(existing: string, lines: string[]): MergeTargetLinesResult {
  const current = parseNucleiPathLines(existing)
  const seen = new Set(current.lines.map((l) => lineKey(l.base, l.path)))
  const added: string[] = []
  const skipped: string[] = []
  const invalid: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    const parsed = parseNucleiPathLines(line)
    const only = parsed.lines[0]
    if (parsed.errors.length > 0 || parsed.lines.length !== 1 || !only) {
      invalid.push(line)
      continue
    }
    const key = lineKey(only.base, only.path)
    if (seen.has(key)) {
      skipped.push(line)
      continue
    }
    seen.add(key)
    added.push(line)
  }
  if (invalid.length > 0) return { text: existing, added: [], skipped, invalid }
  if (added.length === 0) return { text: existing, added, skipped, invalid }
  const trimmed = existing.replace(/\s+$/, '')
  const text = (trimmed === '' ? '' : trimmed + '\n') + added.join('\n') + '\n'
  return { text, added, skipped, invalid }
}
