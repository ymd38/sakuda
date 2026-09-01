/**
 * ZAP reaches a `localhost` target through `env.zap.localhostAlias`
 * (e.g. `host.docker.internal`), so the Firefox that the Ajax spider drives
 * sees a plain-http, non-localhost origin: `isSecureContext` is false and
 * secure-context-only APIs (`crypto.randomUUID`, `crypto.subtle`, service
 * workers…) are undefined. An SPA that touches one of them during auth
 * bootstrap throws before its first API call and silently crawls as an
 * anonymous visitor — no console error, no request.
 *
 * Firefox's `dom.securecontext.allowlist` pref names hosts that count as
 * secure anyway; the ZAP Selenium add-on applies `selenium.firefoxPrefs.*`
 * to every Firefox it launches. Passed to `zap.sh` as `-config key=value`
 * (see `runZap`'s `config`): nothing secret, no file needed.
 */
export const FIREFOX_SECURE_CONTEXT_PREF = 'dom.securecontext.allowlist'

export function buildFirefoxPrefsConfig(alias: string | undefined): Record<string, string> {
  if (!alias) return {}
  return {
    'selenium.firefoxPrefs.pref(0).name': FIREFOX_SECURE_CONTEXT_PREF,
    'selenium.firefoxPrefs.pref(0).value': alias,
    'selenium.firefoxPrefs.pref(0).enabled': 'true',
  }
}
