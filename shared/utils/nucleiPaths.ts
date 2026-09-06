/** HTTP methods a saved target line may carry. GET is the default (and the
 * only one any engine replays until later PRs of Epic #41); the rest are
 * kept through discovery→approval→save so a non-GET endpoint is not silently
 * recorded as a GET. */
export const TARGET_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type TargetMethod = (typeof TARGET_METHODS)[number]

export function isTargetMethod(s: string): s is TargetMethod {
  return (TARGET_METHODS as readonly string[]).includes(s)
}

/** Uppercases a raw crawler method (`get`, `Post`) and validates it against
 * the allowlist; null for anything unsupported (`TRACE`, `CONNECT`, junk),
 * so callers drop it rather than persist a method no engine understands. */
export function normalizeTargetMethod(raw: string): TargetMethod | null {
  const up = raw.trim().toUpperCase()
  return isTargetMethod(up) ? up : null
}

export interface NucleiPathLine {
  lineNo: number
  method: TargetMethod
  base: 'front' | 'api'
  path: string
}

/** Identity of a saved target across sources and re-saves: method + base +
 * path. `GET /x` and `/x` share a key (method defaults to GET), `POST /x` is
 * distinct. The single definition every consumer keys on — the crawl
 * dedupe, the merge, and the review UI's saved/selection state. */
export function targetLineKey(l: Pick<NucleiPathLine, 'method' | 'base' | 'path'>): string {
  return `${l.method}|${l.base}|${l.path}`
}

/** Line grammar: `METHOD [api:]path` — an optional leading HTTP method (case
 * insensitive, defaults to GET), an optional `api:` base prefix, then a path
 * starting with `/`. `#` starts a comment. An unknown method or a missing
 * path is an error (reported per line, nothing is dropped silently). */
export function parseNucleiPathLines(text: string): {
  lines: NucleiPathLine[]
  errors: string[]
} {
  const lines: NucleiPathLine[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const m = /^(?:(\S+)\s+)?(api:)?(\/\S*)$/.exec(line)
    if (!m) {
      errors.push(
        `line ${i + 1}: must be "[METHOD] [api:]/path" — a path starting with "/", optionally prefixed with an HTTP method and/or "api:", got "${line}"`,
      )
      return
    }
    const method = m[1] ? normalizeTargetMethod(m[1]) : 'GET'
    if (method === null) {
      errors.push(
        `line ${i + 1}: unsupported HTTP method "${m[1]}" — use one of ${TARGET_METHODS.join(', ')}`,
      )
      return
    }
    lines.push({ lineNo: i + 1, method, base: m[2] ? 'api' : 'front', path: m[3]! })
  })
  return { lines, errors }
}
