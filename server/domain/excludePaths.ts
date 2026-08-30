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
