import type { SiteRow } from '../db/schema'
import type { SitePublic, SiteSnapshot } from '#shared/types/api'
import { siteRequiresConfirmation } from '#shared/utils/localHost'

/** Pure mappers (no db access) so scanService can depend on them without
 * importing siteService, which itself depends on scanService for
 * `latestScanSummary` — keeping the import graph acyclic. */
export function toSitePublic(row: SiteRow): SitePublic {
  const { headersEnc: _enc, browserStorageEnc: _storageEnc, ...rest } = row // strip ciphertext
  return {
    ...rest,
    requiresConfirmation: siteRequiresConfirmation(
      row.frontBaseUrl,
      row.apiBaseUrl,
      row.openapiUrl,
    ),
  }
}

export function toSiteSnapshot(site: SitePublic): SiteSnapshot {
  const { openapiJson: _openapiJson, createdAt: _c, updatedAt: _u, ...rest } = site // omitted from snapshot
  return { ...rest, hasOpenapiJson: site.openapiJson !== null }
}
