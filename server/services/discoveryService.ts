import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { discoveries, sites, type DiscoveryRow } from '../db/schema'
import { toSitePublic } from '../domain/siteView'
import { hasActiveDiscovery, hasActiveScan } from './activeJobs'
import { ServiceError } from './errors'
import type { DiscoveryDetail, DiscoverySummary } from '#shared/types/api'

const RESTART_ERROR = 'server restarted while the discovery was running'
const DEFAULT_LIST_LIMIT = 10

export function toDiscoverySummary(row: DiscoveryRow): DiscoverySummary {
  return {
    id: row.id,
    siteId: row.siteId,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    urlCount: row.urls.length,
  }
}

export function toDiscoveryDetail(row: DiscoveryRow): DiscoveryDetail {
  return { ...toDiscoverySummary(row), urls: row.urls, meta: row.meta, warnings: row.warnings }
}

export function createDiscovery(
  db: Db,
  deps: { now: () => Date; id: () => string },
  siteId: string,
): DiscoverySummary {
  const siteRow = db.select().from(sites).where(eq(sites.id, siteId)).get()
  if (!siteRow) throw new ServiceError(404, 'SITE_NOT_FOUND', `site ${siteId} not found`)
  const site = toSitePublic(siteRow)
  if (site.requiresConfirmation && !site.nonLocalConfirmed)
    throw new ServiceError(
      422,
      'NON_LOCAL_UNCONFIRMED',
      'site targets a non-local host without confirmation',
    )
  if (hasActiveScan(db, siteId))
    throw new ServiceError(409, 'SCAN_ACTIVE', `site ${siteId} already has an active scan`)
  if (hasActiveDiscovery(db, siteId))
    throw new ServiceError(
      409,
      'DISCOVERY_ACTIVE',
      `site ${siteId} already has an active discovery`,
    )
  const row: DiscoveryRow = {
    id: deps.id(),
    siteId,
    status: 'queued',
    urls: [],
    meta: {},
    warnings: [],
    error: null,
    createdAt: deps.now().toISOString(),
    startedAt: null,
    finishedAt: null,
  }
  db.insert(discoveries).values(row).run()
  return toDiscoverySummary(row)
}

export function getDiscovery(db: Db, id: string): DiscoveryDetail | null {
  const row = db.select().from(discoveries).where(eq(discoveries.id, id)).get()
  return row ? toDiscoveryDetail(row) : null
}

export function listDiscoveries(
  db: Db,
  siteId: string,
  limit = DEFAULT_LIST_LIMIT,
): DiscoverySummary[] {
  return db
    .select()
    .from(discoveries)
    .where(eq(discoveries.siteId, siteId))
    .orderBy(desc(discoveries.createdAt))
    .limit(limit)
    .all()
    .map(toDiscoverySummary)
}

export function claimNextQueuedDiscovery(db: Db, now: () => Date): string | null {
  return db.transaction((tx) => {
    const next = tx
      .select({ id: discoveries.id })
      .from(discoveries)
      .where(eq(discoveries.status, 'queued'))
      .orderBy(discoveries.createdAt)
      .limit(1)
      .get()
    if (!next) return null
    const result = tx
      .update(discoveries)
      .set({ status: 'running', startedAt: now().toISOString() })
      .where(and(eq(discoveries.id, next.id), eq(discoveries.status, 'queued')))
      .run()
    return result.changes > 0 ? next.id : null
  })
}

export function recoverInterruptedDiscoveries(db: Db, now: () => Date): number {
  const result = db
    .update(discoveries)
    .set({ status: 'failed', error: RESTART_ERROR, finishedAt: now().toISOString() })
    .where(eq(discoveries.status, 'running'))
    .run()
  return result.changes
}
