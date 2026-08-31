import { beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { openDatabase, type Db } from '../../db/client'
import { engineRuns, findings, scans, sites } from '../../db/schema'
import { createSiteCipher } from '../../domain/headerCipher'
import { createSite, type SiteServiceDeps } from '../siteService'
import { getScanDetail, getSiteHistory, previousDoneScanId } from '../reportService'
import { SiteInputSchema } from '#shared/schemas/site'
import type { FindingRow } from '../../db/schema'

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const base = SiteInputSchema.parse({
  name: 'shop',
  frontBaseUrl: 'http://localhost:3001/',
  nucleiPaths: '/\n/api/products',
  openapiUrl: 'http://localhost:3001/openapi.json',
})

let db: Db
let siteDeps: SiteServiceDeps
let n = 0

beforeEach(() => {
  n = 0
  db = openDatabase({ file: ':memory:', migrationsFolder })
  siteDeps = {
    db,
    cipher: createSiteCipher(randomBytes(32).toString('base64')),
    now: () => new Date('2026-01-01T00:00:00Z'),
    id: () => `site-${++n}`,
  }
})

function insertScan(
  overrides: Partial<typeof scans.$inferInsert> & {
    id: string
    siteId: string
    createdAt: string
  },
) {
  db.insert(scans)
    .values({
      status: 'done',
      engines: ['nuclei'],
      siteSnapshot: {
        name: 'shop',
        frontBaseUrl: 'http://localhost:3001/',
        apiBaseUrl: null,
        nucleiPaths: '/\n/api/products',
        openapiUrl: 'http://localhost:3001/openapi.json',
        hasOpenapiJson: false,
        zapFeSeedPath: '/',
        discoverySeedPaths: '',
        excludePaths: '',
        nucleiRateLimit: 50,
        zapApiMaxMinutes: 45,
        zapFeSpiderMaxMinutes: 5,
        nonLocalConfirmed: false,
        headerNames: [],
        browserStorageNames: [],
        requiresConfirmation: false,
      },
      error: null,
      startedAt: overrides.createdAt,
      finishedAt: overrides.createdAt,
      ...overrides,
    })
    .run()
}

function insertEngineRun(row: {
  id: string
  scanId: string
  startedAt: string
  counts?: { critical: number; high: number; medium: number; low: number; info: number }
}) {
  db.insert(engineRuns)
    .values({
      id: row.id,
      scanId: row.scanId,
      engine: 'nuclei',
      status: 'done',
      startedAt: row.startedAt,
      finishedAt: row.startedAt,
      exitCode: 0,
      signal: null,
      counts: row.counts ?? { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      meta: {},
      warnings: [],
      error: null,
    })
    .run()
}

function insertFinding(row: {
  id: string
  scanId: string
  engineRunId: string
  fingerprint: string
  ruleId?: string
  severity?: FindingRow['severity']
  url?: string
}) {
  db.insert(findings)
    .values({
      id: row.id,
      scanId: row.scanId,
      engineRunId: row.engineRunId,
      engine: 'nuclei',
      ruleId: row.ruleId ?? 'rule-1',
      name: 'Some finding',
      severity: row.severity ?? 'high',
      url: row.url ?? 'http://localhost:3001/',
      method: 'GET',
      param: null,
      evidence: null,
      description: null,
      solution: null,
      reference: null,
      fingerprint: row.fingerprint,
      raw: {},
    })
    .run()
}

describe('reportService', () => {
  it('previousDoneScanId finds the latest done scan before a given scan, excluding itself', () => {
    const site = createSite(siteDeps, base)
    insertScan({ id: 'scan-1', siteId: site.id, status: 'done', createdAt: '2026-01-01T00:00:00Z' })
    insertScan({
      id: 'scan-failed',
      siteId: site.id,
      status: 'failed',
      createdAt: '2026-01-02T00:00:00Z',
    })
    insertScan({ id: 'scan-2', siteId: site.id, status: 'done', createdAt: '2026-01-03T00:00:00Z' })

    expect(
      previousDoneScanId(db, site.id, { id: 'scan-2', createdAt: '2026-01-03T00:00:00Z' }),
    ).toBe('scan-1')
    expect(
      previousDoneScanId(db, site.id, { id: 'scan-1', createdAt: '2026-01-01T00:00:00Z' }),
    ).toBeNull()
  })

  describe('getScanDetail', () => {
    it('returns null for a missing scan', () => {
      expect(getScanDetail(db, 'nope')).toBeNull()
    })

    it('builds diff against the previous done scan, marking new/persisting findings', () => {
      const site = createSite(siteDeps, base)
      insertScan({
        id: 'scan-1',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-01T00:00:00Z',
      })
      insertEngineRun({ id: 'run-1', scanId: 'scan-1', startedAt: '2026-01-01T00:00:00Z' })
      insertFinding({ id: 'f-a', scanId: 'scan-1', engineRunId: 'run-1', fingerprint: 'A' })
      insertFinding({ id: 'f-b', scanId: 'scan-1', engineRunId: 'run-1', fingerprint: 'B' })

      insertScan({
        id: 'scan-failed',
        siteId: site.id,
        status: 'failed',
        createdAt: '2026-01-02T00:00:00Z',
      })

      insertScan({
        id: 'scan-2',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-03T00:00:00Z',
      })
      insertEngineRun({ id: 'run-2', scanId: 'scan-2', startedAt: '2026-01-03T00:00:00Z' })
      insertFinding({ id: 'f-b2', scanId: 'scan-2', engineRunId: 'run-2', fingerprint: 'B' })
      insertFinding({ id: 'f-c', scanId: 'scan-2', engineRunId: 'run-2', fingerprint: 'C' })

      const detail1 = getScanDetail(db, 'scan-1')
      expect(detail1?.diff).toBeNull()
      expect(detail1?.findings.every((f) => f.isNew)).toBe(true)

      const detail2 = getScanDetail(db, 'scan-2')
      expect(detail2).not.toBeNull()
      expect(detail2?.siteName).toBe('shop')
      expect(detail2?.diff?.previousScanId).toBe('scan-1')
      expect(detail2?.diff?.newCount).toBe(1)
      expect(detail2?.diff?.persistingCount).toBe(1)
      expect(detail2?.diff?.resolved).toHaveLength(1)
      expect(detail2?.diff?.resolved[0]?.fingerprint).toBe('A')
      expect(detail2?.diff?.resolved[0]?.isNew).toBe(false)

      const findingC = detail2?.findings.find((f) => f.fingerprint === 'C')
      const findingB = detail2?.findings.find((f) => f.fingerprint === 'B')
      expect(findingC?.isNew).toBe(true)
      expect(findingB?.isNew).toBe(false)
    })

    it('dedupes diff.resolved by fingerprint when the previous scan reported it twice', () => {
      const site = createSite(siteDeps, base)
      insertScan({
        id: 'scan-1',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-01T00:00:00Z',
      })
      insertEngineRun({ id: 'run-1', scanId: 'scan-1', startedAt: '2026-01-01T00:00:00Z' })
      // Two finding rows sharing one fingerprint (e.g. two engine runs
      // reporting the same underlying issue) — `resolved` must still count
      // it once, matching the unique-fingerprint count in newCount/persistingCount.
      insertFinding({
        id: 'f-a1',
        scanId: 'scan-1',
        engineRunId: 'run-1',
        fingerprint: 'A',
        ruleId: 'rule-a',
      })
      insertFinding({
        id: 'f-a2',
        scanId: 'scan-1',
        engineRunId: 'run-1',
        fingerprint: 'A',
        ruleId: 'rule-a-dup',
      })

      insertScan({
        id: 'scan-2',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-02T00:00:00Z',
      })
      insertEngineRun({ id: 'run-2', scanId: 'scan-2', startedAt: '2026-01-02T00:00:00Z' })

      const detail = getScanDetail(db, 'scan-2')
      expect(detail?.diff?.resolved).toHaveLength(1)
      expect(detail?.diff?.resolved[0]?.fingerprint).toBe('A')
    })

    it('orders engineRuns by startedAt and findings by severity, ruleId, url', () => {
      const site = createSite(siteDeps, base)
      insertScan({
        id: 'scan-1',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-01T00:00:00Z',
      })
      insertEngineRun({ id: 'run-b', scanId: 'scan-1', startedAt: '2026-01-01T00:05:00Z' })
      insertEngineRun({ id: 'run-a', scanId: 'scan-1', startedAt: '2026-01-01T00:00:00Z' })
      insertFinding({
        id: 'f-1',
        scanId: 'scan-1',
        engineRunId: 'run-a',
        fingerprint: 'x1',
        severity: 'medium',
        ruleId: 'r2',
        url: 'http://localhost:3001/b',
      })
      insertFinding({
        id: 'f-2',
        scanId: 'scan-1',
        engineRunId: 'run-a',
        fingerprint: 'x2',
        severity: 'critical',
        ruleId: 'r1',
        url: 'http://localhost:3001/a',
      })
      insertFinding({
        id: 'f-3',
        scanId: 'scan-1',
        engineRunId: 'run-a',
        fingerprint: 'x3',
        severity: 'medium',
        ruleId: 'r1',
        url: 'http://localhost:3001/a',
      })

      const detail = getScanDetail(db, 'scan-1')
      expect(detail?.engineRuns.map((r) => r.id)).toEqual(['run-a', 'run-b'])
      expect(detail?.findings.map((f) => f.id)).toEqual(['f-2', 'f-3', 'f-1'])
    })

    it('falls back to the site snapshot name when the site row is gone', () => {
      const site = createSite(siteDeps, base)
      insertScan({
        id: 'scan-1',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-01T00:00:00Z',
      })
      // The schema cascade-deletes scans when their site is deleted, which
      // would make this scenario unreachable through the app's own code
      // paths (deleteSite). Toggle the FK pragma off just for this delete so
      // the fixture can exercise the defensive "site row is gone" branch.
      db.run(sql`PRAGMA foreign_keys = OFF`)
      db.delete(sites).where(eq(sites.id, site.id)).run()
      db.run(sql`PRAGMA foreign_keys = ON`)

      const detail = getScanDetail(db, 'scan-1')
      expect(detail?.siteName).toBe('shop')
    })
  })

  describe('getSiteHistory', () => {
    it('returns points oldest-first with diff null for failed scans and for the first done scan', () => {
      const site = createSite(siteDeps, base)
      insertScan({
        id: 'scan-1',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-01T00:00:00Z',
      })
      insertEngineRun({
        id: 'run-1',
        scanId: 'scan-1',
        startedAt: '2026-01-01T00:00:00Z',
        counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      })
      insertFinding({ id: 'f-a', scanId: 'scan-1', engineRunId: 'run-1', fingerprint: 'A' })
      insertFinding({ id: 'f-b', scanId: 'scan-1', engineRunId: 'run-1', fingerprint: 'B' })

      insertScan({
        id: 'scan-failed',
        siteId: site.id,
        status: 'failed',
        createdAt: '2026-01-02T00:00:00Z',
      })
      insertEngineRun({
        id: 'run-failed',
        scanId: 'scan-failed',
        startedAt: '2026-01-02T00:00:00Z',
        counts: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
      })

      insertScan({
        id: 'scan-2',
        siteId: site.id,
        status: 'done',
        createdAt: '2026-01-03T00:00:00Z',
      })
      insertEngineRun({
        id: 'run-2',
        scanId: 'scan-2',
        startedAt: '2026-01-03T00:00:00Z',
        counts: { critical: 0, high: 2, medium: 0, low: 0, info: 0 },
      })
      insertFinding({ id: 'f-b2', scanId: 'scan-2', engineRunId: 'run-2', fingerprint: 'B' })
      insertFinding({ id: 'f-c', scanId: 'scan-2', engineRunId: 'run-2', fingerprint: 'C' })

      const history = getSiteHistory(db, site.id)
      expect(history.map((p) => p.scanId)).toEqual(['scan-1', 'scan-failed', 'scan-2'])
      expect(history[0]?.diff).toBeNull()
      expect(history[1]?.diff).toBeNull()
      expect(history[1]?.status).toBe('failed')
      expect(history[1]?.counts).toEqual({ critical: 0, high: 0, medium: 1, low: 0, info: 0 })
      expect(history[2]?.diff).toEqual({ new: 1, persisting: 1, resolved: 1 })
      expect(history[0]?.counts).toEqual({ critical: 1, high: 0, medium: 0, low: 0, info: 0 })
      expect(history[0]?.engines.nuclei).toEqual({
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      })
    })

    it('returns an empty array for a site with no done/failed scans', () => {
      const site = createSite(siteDeps, base)
      expect(getSiteHistory(db, site.id)).toEqual([])
    })
  })
})
