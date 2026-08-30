import { beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { openDatabase, type Db } from '../../db/client'
import { engineRuns, scans, sites } from '../../db/schema'
import { createHeaderCipher } from '../../domain/headerCipher'
import { createSite, type SiteServiceDeps } from '../siteService'
import { ServiceError } from '../errors'
import {
  claimNextQueuedScan,
  createScan,
  latestScanSummary,
  listScans,
  recoverInterruptedScans,
} from '../scanService'
import { SiteInputSchema } from '#shared/schemas/site'

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
let t = 0
const now = () => new Date(2026 + t, 0, 1 + t++)
const id = () => `id-${++n}`

beforeEach(() => {
  n = 0
  t = 0
  db = openDatabase({ file: ':memory:', migrationsFolder })
  siteDeps = {
    db,
    cipher: createHeaderCipher(randomBytes(32).toString('base64')),
    now: () => new Date('2026-01-01T00:00:00Z'),
    id: () => `site-${++n}`,
  }
})

function insertRawSite(overrides: Partial<typeof sites.$inferInsert> = {}) {
  const rowId = `raw-${++n}`
  db.insert(sites)
    .values({
      id: rowId,
      name: 'raw site',
      frontBaseUrl: 'https://x.example.com',
      apiBaseUrl: null,
      nucleiPaths: '/',
      openapiUrl: null,
      openapiJson: null,
      zapFeSeedPath: '/',
      excludePaths: '',
      nucleiRateLimit: 50,
      zapApiMaxMinutes: 45,
      zapFeSpiderMaxMinutes: 5,
      nonLocalConfirmed: false,
      headersEnc: null,
      headerNames: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    })
    .run()
  return rowId
}

describe('createScan', () => {
  it('returns a queued scan with engines ordered by ENGINE_ORDER', () => {
    const site = createSite(siteDeps, base)
    const scan = createScan(db, { now, id }, site.id, ['zap-fe', 'nuclei'])
    expect(scan.status).toBe('queued')
    expect(scan.engines).toEqual(['nuclei', 'zap-fe'])
    expect(scan.siteId).toBe(site.id)
    expect(scan.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 })
  })

  it('throws 404 SITE_NOT_FOUND for an unknown site', () => {
    expect(() => createScan(db, { now, id }, 'nope', ['nuclei'])).toThrow(ServiceError)
    try {
      createScan(db, { now, id }, 'nope', ['nuclei'])
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError)
      expect((e as ServiceError).statusCode).toBe(404)
      expect((e as ServiceError).code).toBe('SITE_NOT_FOUND')
    }
  })

  it('rejects a second scan while one is queued/running with 409 SCAN_ACTIVE', () => {
    const site = createSite(siteDeps, base)
    createScan(db, { now, id }, site.id, ['nuclei'])
    try {
      createScan(db, { now, id }, site.id, ['nuclei'])
      expect.fail('expected ServiceError')
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError)
      expect((e as ServiceError).statusCode).toBe(409)
      expect((e as ServiceError).code).toBe('SCAN_ACTIVE')
    }
  })

  it('422 NON_LOCAL_UNCONFIRMED for a non-local site inserted without confirmation', () => {
    const siteId = insertRawSite()
    try {
      createScan(db, { now, id }, siteId, ['nuclei'])
      expect.fail('expected ServiceError')
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError)
      expect((e as ServiceError).statusCode).toBe(422)
      expect((e as ServiceError).code).toBe('NON_LOCAL_UNCONFIRMED')
    }
  })

  it('422 ENGINE_PREREQ for zap-api without an openapi source', () => {
    const site = createSite(siteDeps, { ...base, openapiUrl: null })
    try {
      createScan(db, { now, id }, site.id, ['zap-api'])
      expect.fail('expected ServiceError')
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError)
      expect((e as ServiceError).statusCode).toBe(422)
      expect((e as ServiceError).code).toBe('ENGINE_PREREQ')
    }
  })

  it('422 ENGINE_PREREQ for nuclei with empty nucleiPaths', () => {
    const site = createSite(siteDeps, { ...base, nucleiPaths: '' })
    try {
      createScan(db, { now, id }, site.id, ['nuclei'])
      expect.fail('expected ServiceError')
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError)
      expect((e as ServiceError).statusCode).toBe(422)
      expect((e as ServiceError).code).toBe('ENGINE_PREREQ')
    }
  })

  it('zap-fe has no prerequisite', () => {
    const site = createSite(siteDeps, { ...base, nucleiPaths: '', openapiUrl: null })
    const scan = createScan(db, { now, id }, site.id, ['zap-fe'])
    expect(scan.engines).toEqual(['zap-fe'])
  })
})

describe('claimNextQueuedScan', () => {
  it('claims the oldest queued scan, flips it to running, then returns null', () => {
    const site = createSite(siteDeps, base)
    const scan = createScan(db, { now, id }, site.id, ['nuclei'])

    const claimed = claimNextQueuedScan(db, now)
    expect(claimed).toBe(scan.id)

    const row = db.select().from(scans).where(eq(scans.id, scan.id)).get()
    expect(row?.status).toBe('running')
    expect(row?.startedAt).not.toBeNull()

    expect(claimNextQueuedScan(db, now)).toBeNull()
  })

  it('claims the oldest of several queued scans', () => {
    const site1 = createSite(siteDeps, base)
    const site2 = createSite(siteDeps, { ...base, name: 'other' })
    const scan1 = createScan(db, { now, id }, site1.id, ['nuclei'])
    const scan2 = createScan(db, { now, id }, site2.id, ['nuclei'])
    expect(claimNextQueuedScan(db, now)).toBe(scan1.id)
    expect(claimNextQueuedScan(db, now)).toBe(scan2.id)
  })
})

describe('recoverInterruptedScans', () => {
  it('marks running scans and their running engine runs as failed', () => {
    const site = createSite(siteDeps, base)
    const scan = createScan(db, { now, id }, site.id, ['nuclei'])
    claimNextQueuedScan(db, now)
    db.insert(engineRuns)
      .values({
        id: 'run-1',
        scanId: scan.id,
        engine: 'nuclei',
        status: 'running',
        startedAt: now().toISOString(),
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        meta: {},
        warnings: [],
      })
      .run()

    const recovered = recoverInterruptedScans(db, now)
    expect(recovered).toBe(1)

    const scanRow = db.select().from(scans).where(eq(scans.id, scan.id)).get()
    expect(scanRow?.status).toBe('failed')
    expect(scanRow?.error).toBe('server restarted while the scan was running')
    expect(scanRow?.finishedAt).not.toBeNull()

    const runRow = db.select().from(engineRuns).where(eq(engineRuns.id, 'run-1')).get()
    expect(runRow?.status).toBe('failed')
    expect(runRow?.error).toBe('server restarted while the scan was running')

    expect(recoverInterruptedScans(db, now)).toBe(0)
  })

  it('does not touch queued or done scans', () => {
    const site = createSite(siteDeps, base)
    createScan(db, { now, id }, site.id, ['nuclei'])
    expect(recoverInterruptedScans(db, now)).toBe(0)
  })
})

describe('listScans / latestScanSummary', () => {
  it('lists scans newest first and sums engine_runs counts', () => {
    const site = createSite(siteDeps, base)
    const scan1 = createScan(db, { now, id }, site.id, ['nuclei'])
    claimNextQueuedScan(db, now)
    db.update(scans)
      .set({ status: 'done', finishedAt: now().toISOString() })
      .where(eq(scans.id, scan1.id))
      .run()
    db.insert(engineRuns)
      .values({
        id: 'run-a',
        scanId: scan1.id,
        engine: 'nuclei',
        status: 'done',
        startedAt: now().toISOString(),
        finishedAt: now().toISOString(),
        counts: { critical: 1, high: 2, medium: 0, low: 0, info: 0 },
        meta: {},
        warnings: [],
      })
      .run()

    const scan2 = createScan(db, { now, id }, site.id, ['zap-fe'])

    const list = listScans(db, site.id)
    expect(list.map((s) => s.id)).toEqual([scan2.id, scan1.id])
    expect(list[1]?.counts).toEqual({ critical: 1, high: 2, medium: 0, low: 0, info: 0 })

    expect(latestScanSummary(db, site.id)?.id).toBe(scan2.id)
  })

  it('returns null when the site has no scans', () => {
    const site = createSite(siteDeps, base)
    expect(latestScanSummary(db, site.id)).toBeNull()
    expect(listScans(db, site.id)).toEqual([])
  })
})
