const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function rewriteLoopbackHost(url: string, alias: string | undefined): string {
  if (!alias) return url
  const u = new URL(url)
  if (LOOPBACK.has(u.hostname)) u.hostname = alias
  return u.toString()
}

export function restoreLoopbackHost(
  url: string,
  alias: string | undefined,
  originalHost: string,
): string {
  if (!alias || !URL.canParse(url)) return url
  const u = new URL(url)
  if (u.hostname === alias) u.hostname = originalHost
  return u.toString()
}

// Always pass full URLs with a path; URL.toString() appends '/' to bare origins.
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
