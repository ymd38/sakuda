import type { SitePublic } from '../types/api'

export type ActiveScanSite = Pick<
  SitePublic,
  'allowMutatingRequests' | 'requiresConfirmation' | 'nonLocalConfirmed'
>

/**
 * The one place that decides whether a scan may send active requests
 * (attack payloads that can alter the target's state). Every engine that
 * has an active mode — nuclei's DAST templates, ZAP's FE activeScan, the
 * form-submitting discovery — reads this and never re-derives it, and the
 * UI that warns about it reads the same function, so what it announces is
 * what the engines do.
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
