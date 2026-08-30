export function isLocalHost(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h === 'host.docker.internal') return true
  if (h.endsWith('.local')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function isLocalUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  return isLocalHost(new URL(url).hostname)
}

export function siteRequiresConfirmation(
  frontBaseUrl: string,
  apiBaseUrl: string | null | undefined,
): boolean {
  return !isLocalUrl(frontBaseUrl) || (!!apiBaseUrl && !isLocalUrl(apiBaseUrl))
}
