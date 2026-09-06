/**
 * Reachability of the zap-fe seed, read from ZAP's own output rather than
 * inferred from alerts: the Automation Framework prints
 * `Job spider failed to access URL <url> : <reason>` to stderr when the
 * spider cannot fetch a URL, and the site tree (see `siteTreeDump`) lists
 * what the spiders actually requested. Pure functions; the runner decides
 * what to warn about.
 */

export interface JobAccessFailure {
  job: string
  url: string
  reason: string
}

// The three `spider.automation.error.url.*` messages of ZAP's spider add-on
// (Messages.properties): `failed` is the generic one; `badhost` and
// `badhost.proxychain` are raised for an unknown host — a DNS failure on the
// target or on the outgoing proxy — and insert a hint before the colon. The
// hints are matched verbatim rather than with a wildcard because the reason
// after the colon may itself contain colons.
const ACCESS_FAILURE_LINE =
  /^Job (\S+) failed to access URL (\S+)(?: check that it is valid| your proxy chain may be wrong)? : (.+)$/

/** Every `Job <job> failed to access URL <url> [<hint>] : <reason>` line of a
 * ZAP stderr log, in order. Other lines (JVM banners, stack traces) are
 * ignored. */
export function parseJobAccessFailures(stderr: string): JobAccessFailure[] {
  const failures: JobAccessFailure[] = []
  for (const line of stderr.split(/\r?\n/)) {
    const m = ACCESS_FAILURE_LINE.exec(line.trim())
    if (m) failures.push({ job: m[1]!, url: m[2]!, reason: m[3]!.trim() })
  }
  return failures
}

/** `pathname + search` with the fragment dropped and one trailing slash
 * removed (`/dash/` and `/dash` are the same page to the spider); the root
 * stays `/`. Relative paths resolve against a dummy origin. */
function serverPath(urlOrPath: string): string | null {
  if (!URL.canParse(urlOrPath, 'http://sakuda.invalid')) return null
  const u = new URL(urlOrPath, 'http://sakuda.invalid')
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : u.pathname
  return path + u.search
}

/** True when `failure` is the traditional spider failing on the seed URL
 * itself — not some other page it found later. Compared without fragment or
 * trailing slash, on the same host the failure was logged with. */
export function isSeedAccessFailure(failure: JobAccessFailure, seedUrl: string): boolean {
  if (failure.job !== 'spider') return false
  if (!URL.canParse(failure.url) || !URL.canParse(seedUrl)) return false
  const a = new URL(failure.url)
  const b = new URL(seedUrl)
  return a.origin === b.origin && serverPath(failure.url) === serverPath(seedUrl)
}

/**
 * Whether the seed page is among the URLs the spiders crawled. `null` when
 * the seed cannot be checked: its server-side path is `/` — a plain `/` seed,
 * or a hash route like `/#/dashboard`, whose fragment never reaches the
 * server — so "reached" would only ever mean "reached the root", which says
 * nothing about the page the user meant.
 */
export function seedPathReached(seedPath: string, crawledUrls: readonly string[]): boolean | null {
  const seed = serverPath(seedPath)
  if (seed === null || seed === '/') return null
  return crawledUrls.some((u) => serverPath(u) === seed)
}
