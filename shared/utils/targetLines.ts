import {
  normalizeTargetMethod,
  parseNucleiPathLines,
  targetLineKey,
  type TargetMethod,
} from './nucleiPaths'

/** The site fields needed to turn an absolute URL back into a saved target
 * line (`/path?q=1` on the front base, `api:/path` on the api base). */
export interface TargetLineSite {
  frontBaseUrl: string
  apiBaseUrl: string | null
}

/** Renders a saved target line: `POST /x`, `api:/x`, `/x` (GET, no prefix). */
function formatTargetLine(method: TargetMethod, base: 'front' | 'api', path: string): string {
  const prefix = method === 'GET' ? '' : `${method} `
  return `${prefix}${base === 'api' ? 'api:' : ''}${path}`
}

/** Converts a discovered absolute URL + method into the relative line format
 * stored in `sites.nucleiPaths` (SPEC §3.1: targets are relative to the base
 * URLs so a port/host change never requires rewriting them). `method`
 * defaults to GET and is uppercased; returns null for a URL on neither base
 * origin, or a method outside the allowlist (so an unsupported verb is never
 * offered for saving — `mergeTargetLines` rejects the whole batch on one bad
 * line). */
export function urlToTargetLine(
  site: TargetLineSite,
  url: string,
  method: string = 'GET',
): string | null {
  if (!URL.canParse(url)) return null
  const m = normalizeTargetMethod(method)
  if (m === null) return null
  const u = new URL(url)
  const path = `${u.pathname}${u.search}`
  if (u.origin === new URL(site.frontBaseUrl).origin) return formatTargetLine(m, 'front', path)
  if (site.apiBaseUrl && u.origin === new URL(site.apiBaseUrl).origin)
    return formatTargetLine(m, 'api', path)
  return null
}

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
 * already present and of each other. Duplicate identity is method + base +
 * path (see {@link targetLineKey}), so a saved `GET /x` does not block a new
 * `POST /x`, but a re-saved `GET /x` (or bare `/x`) is a no-op. Existing
 * content is preserved verbatim (a user's comments and ordering are theirs),
 * so this is append-only. */
export function mergeTargetLines(existing: string, lines: string[]): MergeTargetLinesResult {
  const current = parseNucleiPathLines(existing)
  const seen = new Set(current.lines.map(targetLineKey))
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
    const key = targetLineKey(only)
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

export interface RemoveTargetLineResult {
  /** The new `nucleiPaths` text: every other line (comments, blanks, ordering) kept verbatim. */
  text: string
  /** False when no saved line matched — the removal is a no-op, `text` is `existing`. */
  removed: boolean
  /** True when `line` is not a valid target line; nothing is removed. */
  invalid: boolean
}

/** Removes one saved target — every text line with that identity (method +
 * base + path, see {@link targetLineKey}), so `/x`, `GET /x` and `get /x`
 * all remove the same saved entry while `POST /x` is left alone. A hand-edited
 * list can hold the same target twice; the review UI's "saved" badge is per
 * identity, so un-saving must drop every duplicate or the badge would stay
 * and the target would still be scanned. The rest of the text is kept
 * verbatim — the counterpart of {@link mergeTargetLines}, which never touches
 * existing content either. Idempotent: removing a line that is not saved
 * returns the text unchanged with `removed: false`. */
export function removeTargetLine(existing: string, line: string): RemoveTargetLineResult {
  const parsed = parseNucleiPathLines(line)
  const only = parsed.lines[0]
  if (parsed.errors.length > 0 || parsed.lines.length !== 1 || !only)
    return { text: existing, removed: false, invalid: true }
  const key = targetLineKey(only)
  let removed = false
  const kept = existing.split(/\r?\n/).filter((raw) => {
    const saved = parseNucleiPathLines(raw).lines[0]
    if (!saved || targetLineKey(saved) !== key) return true
    removed = true
    return false
  })
  return { text: removed ? kept.join('\n') : existing, removed, invalid: false }
}
