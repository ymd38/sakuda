/**
 * Normalizes a finding URL for fingerprinting: lowercase scheme/host (via
 * `URL`), path only — query strings and fragments are dropped so that e.g.
 * differing CSRF tokens or pagination params don't split one finding into
 * many across scans.
 */
export function normalizeUrlForFingerprint(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    // boundary: engines occasionally report a non-URL host/target string
    // (e.g. a raw hostname); keep it verbatim rather than dropping the finding.
    return url.trim()
  }
}

export function buildFingerprint(f: {
  engine: string
  ruleId: string
  url: string
  param: string | null
}): string {
  return `${f.engine}|${f.ruleId}|${normalizeUrlForFingerprint(f.url)}|${f.param ?? ''}`
}
