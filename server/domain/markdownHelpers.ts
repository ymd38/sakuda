// Shared Markdown-safety and meta-narrowing helpers used by both
// markdownReport.ts and markdownEngineMeta.ts. This is a leaf module — it
// must never import from either of those two, so they can freely import
// from here without a circular dependency.

/** Wraps a value as inline code, neutralising characters that would break
 * the span itself or a table cell it sits in: backticks/newlines become a
 * space, pipes are escaped. */
export function code(s: string | null | undefined): string {
  return '`' + (s ?? '').replace(/[`\r\n]/g, ' ').replace(/\|/g, '\\|') + '`'
}

/** Plain text safe for a Markdown table cell / single line. */
export function text(s: string | null | undefined): string {
  return (s ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')
}

export function fmtDuration(sec: number | undefined): string {
  if (sec === undefined || sec <= 0) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

/** Fences `content` for a code block, escalating the fence marker if the
 * content itself contains a triple-backtick sequence. Newlines are
 * preserved — an engine error/runbook is meant to read as-is, multi-line;
 * callers needing single-line safety should call `text()` themselves before
 * fencing. */
export function fence(content: string): string[] {
  const marker = content.includes('```') ? '````' : '```'
  return [marker, content, marker]
}

// ---------- meta narrowing helpers (no `as` casts) ----------
// `meta` is stored as `Record<string, unknown>`; these read one field back
// out with a runtime type check instead of a cast.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function metaNumber(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key]
  return typeof v === 'number' ? v : undefined
}

export function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key]
  return typeof v === 'string' ? v : undefined
}

export function metaStringArray(meta: Record<string, unknown>, key: string): string[] | undefined {
  const v = meta[key]
  if (!Array.isArray(v)) return undefined
  return v.every((x): x is string => typeof x === 'string') ? v : undefined
}

export function metaRecord(
  meta: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = meta[key]
  return isRecord(v) ? v : undefined
}

export function metaBoolean(meta: Record<string, unknown>, key: string): boolean {
  return meta[key] === true
}
