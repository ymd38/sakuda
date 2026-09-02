import type { SitePublic } from '#shared/types/api'

export type ActiveScanSite = Pick<
  SitePublic,
  'allowMutatingRequests' | 'requiresConfirmation' | 'nonLocalConfirmed'
>

/**
 * The one place that decides whether a scan may send active requests
 * (attack payloads that can alter the target's state). Every engine that
 * has an active mode — today nuclei's DAST templates, next ZAP's FE
 * activeScan (#17) — reads this and never re-derives it.
 *
 * Mirrors SPEC §6.1's "environment ∧ scope" conjunction on the MVP's single
 * `sites` row: the user opted this site in (scope) AND ownership of the host
 * is established — local, or non-local and explicitly confirmed
 * (environment). `SiteInputSchema` already refuses an unconfirmed non-local
 * site, so the second term is defence in depth for stale snapshots.
 */
export function isActiveScanEnabled(site: ActiveScanSite): boolean {
  if (!site.allowMutatingRequests) return false
  return !site.requiresConfirmation || site.nonLocalConfirmed
}

/** How many target URLs carry query parameters — the only inputs nuclei's
 * DAST templates can fuzz. Zero with active checks on means the run will
 * silently do no injection testing, which the caller should warn about. */
export function countParameterizedUrls(urls: string[]): number {
  return urls.filter((u) => URL.canParse(u) && new URL(u).search.length > 1).length
}

/** Placeholder value given to an empty-valued query parameter so nuclei's
 * DAST fuzzer has a seed to mutate (see {@link seedEmptyQueryValues}). */
export const FUZZ_SEED_VALUE = '1'

/**
 * Gives every empty-valued query parameter a placeholder value so nuclei's
 * DAST fuzzer will actually mutate it. nuclei skips a parameter whose value
 * is empty (`?q=`), so a target discovery saved as `/search?q=` — the common
 * shape — would be fuzzed on nothing. `/search?q=` becomes `/search?q=1`;
 * a parameter that already has a value is left untouched.
 *
 * Applied only to the transient targets file of an *active* run, never to the
 * site's saved target list or to discovery output — it changes what this one
 * scan sends, not what the site stores. A URL that does not parse is returned
 * unchanged rather than dropped (the engine still reports on it).
 */
export function seedEmptyQueryValues(urls: string[], seed: string = FUZZ_SEED_VALUE): string[] {
  return urls.map((u) => {
    if (!URL.canParse(u)) return u
    const parsed = new URL(u)
    if (parsed.search.length <= 1) return u // no query params at all
    let changed = false
    for (const key of [...parsed.searchParams.keys()]) {
      if (parsed.searchParams.get(key) === '') {
        parsed.searchParams.set(key, seed)
        changed = true
      }
    }
    return changed ? parsed.toString() : u
  })
}
