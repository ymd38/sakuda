import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { discoveries, scans, sites } from '../db/schema'
import type { JobView } from '#shared/types/api'

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

/**
 * All running + queued jobs across every site, in the job loop's claim order
 * (see `jobLoop.claimNext`): the running job first, then queued scans
 * oldest-first, then queued discoveries oldest-first. Display order therefore
 * equals execution order. Two queries (scans, discoveries), each joined to
 * `sites` for the name — never one query per site.
 */
export function listActiveJobs(db: Db): JobView[] {
  const scanRows = db
    .select({
      id: scans.id,
      siteId: scans.siteId,
      siteName: sites.name,
      status: scans.status,
      engines: scans.engines,
      createdAt: scans.createdAt,
      startedAt: scans.startedAt,
    })
    .from(scans)
    .innerJoin(sites, eq(scans.siteId, sites.id))
    .where(inArray(scans.status, [...ACTIVE_JOB_STATUSES]))
    .orderBy(asc(scans.createdAt))
    .all()

  const discoveryRows = db
    .select({
      id: discoveries.id,
      siteId: discoveries.siteId,
      siteName: sites.name,
      status: discoveries.status,
      createdAt: discoveries.createdAt,
      startedAt: discoveries.startedAt,
    })
    .from(discoveries)
    .innerJoin(sites, eq(discoveries.siteId, sites.id))
    .where(inArray(discoveries.status, [...ACTIVE_JOB_STATUSES]))
    .orderBy(asc(discoveries.createdAt))
    .all()

  const scanJobs = scanRows.map((r): JobView => ({
    kind: 'scan',
    status: r.status as 'running' | 'queued',
    id: r.id,
    siteId: r.siteId,
    siteName: r.siteName,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    engines: r.engines,
  }))
  const discoveryJobs = discoveryRows.map((r): JobView => ({
    kind: 'discovery',
    status: r.status as 'running' | 'queued',
    id: r.id,
    siteId: r.siteId,
    siteName: r.siteName,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
  }))

  // claim order: running first, then queued scans, then queued discoveries;
  // within each queue oldest-first (both queries already sorted). The worker
  // is sequential so there is only ever one running job, but order the running
  // section by start time (kind as tie-breaker, scan first) so the display
  // stays correct even if that ever changes.
  const running = [...scanJobs, ...discoveryJobs]
    .filter((j) => j.status === 'running')
    .sort((a, b) => {
      const at = a.startedAt ?? a.createdAt
      const bt = b.startedAt ?? b.createdAt
      if (at !== bt) return at.localeCompare(bt)
      return a.kind === b.kind ? 0 : a.kind === 'scan' ? -1 : 1
    })
  const queuedScans = scanJobs.filter((j) => j.status === 'queued')
  const queuedDiscoveries = discoveryJobs.filter((j) => j.status === 'queued')
  return [...running, ...queuedScans, ...queuedDiscoveries]
}
