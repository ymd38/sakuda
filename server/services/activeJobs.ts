import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { discoveries, scans } from '../db/schema'

export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const

/** A site runs one job at a time: a scan and a discovery both drive ZAP /
 * nuclei against the same target, and the job loop is sequential anyway.
 * These two checks live apart from scanService / discoveryService so each
 * can consult the other's table without a circular import. */
export function hasActiveScan(db: Db, siteId: string): boolean {
  return (
    db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.siteId, siteId), inArray(scans.status, [...ACTIVE_JOB_STATUSES])))
      .get() !== undefined
  )
}

export function hasActiveDiscovery(db: Db, siteId: string): boolean {
  return (
    db
      .select({ id: discoveries.id })
      .from(discoveries)
      .where(
        and(eq(discoveries.siteId, siteId), inArray(discoveries.status, [...ACTIVE_JOB_STATUSES])),
      )
      .get() !== undefined
  )
}
