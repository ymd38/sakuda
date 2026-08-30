import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { sites } from '../db/schema'
import type { HeaderCipher } from '../domain/headerCipher'
import { toSitePublic } from '../domain/siteView'
import { ServiceError } from './errors'
import { latestScanSummary } from './scanService'
import type { Header } from '#shared/schemas/headers'
import type { SiteInput } from '#shared/schemas/site'
import type { SiteListItem, SitePublic } from '#shared/types/api'

export { toSitePublic, toSiteSnapshot } from '../domain/siteView'

export interface SiteServiceDeps {
  db: Db
  cipher: HeaderCipher
  now: () => Date
  id: () => string
}

export interface SiteWithHeaders extends SitePublic {
  headers: Header[]
}

function sealHeaders(deps: SiteServiceDeps, siteId: string, headers: Header[]) {
  if (headers.length === 0) return { headersEnc: null, headerNames: [] as string[] }
  return { headersEnc: deps.cipher.seal(headers, siteId), headerNames: headers.map((h) => h.name) }
}

function getSiteOrThrow(db: Db, id: string): SitePublic {
  const s = getSite(db, id)
  if (!s) throw new ServiceError(404, 'SITE_NOT_FOUND', `site ${id} not found`)
  return s
}

export function getSite(db: Db, id: string): SitePublic | null {
  const row = db.select().from(sites).where(eq(sites.id, id)).get()
  return row ? toSitePublic(row) : null
}

export function createSite(deps: SiteServiceDeps, input: SiteInput): SitePublic {
  const id = deps.id()
  const now = deps.now().toISOString()
  const { headers = [], ...fields } = input
  deps.db
    .insert(sites)
    .values({ id, ...fields, ...sealHeaders(deps, id, headers), createdAt: now, updatedAt: now })
    .run()
  return getSiteOrThrow(deps.db, id)
}

export function updateSite(deps: SiteServiceDeps, id: string, input: SiteInput): SitePublic {
  const existing = deps.db.select().from(sites).where(eq(sites.id, id)).get()
  if (!existing) throw new ServiceError(404, 'SITE_NOT_FOUND', `site ${id} not found`)
  const { headers, ...fields } = input
  const sealed = headers === undefined ? {} : sealHeaders(deps, id, headers)
  deps.db
    .update(sites)
    .set({ ...fields, ...sealed, updatedAt: deps.now().toISOString() })
    .where(eq(sites.id, id))
    .run()
  return getSiteOrThrow(deps.db, id)
}

export function deleteSite(db: Db, id: string): boolean {
  return db.delete(sites).where(eq(sites.id, id)).run().changes > 0
}

export function listSites(db: Db): SiteListItem[] {
  return db
    .select()
    .from(sites)
    .orderBy(desc(sites.updatedAt))
    .all()
    .map((r) => ({ ...toSitePublic(r), lastScan: latestScanSummary(db, r.id) }))
}

export function loadSiteWithHeaders(deps: SiteServiceDeps, id: string): SiteWithHeaders | null {
  const row = deps.db.select().from(sites).where(eq(sites.id, id)).get()
  if (!row) return null
  return {
    ...toSitePublic(row),
    headers: row.headersEnc ? deps.cipher.open(row.headersEnc, id) : [],
  }
}
