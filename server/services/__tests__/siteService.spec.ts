import { beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../../db/client'
import { scans } from '../../db/schema'
import { createSiteCipher } from '../../domain/headerCipher'
import { createScan } from '../scanService'
import { ServiceError } from '../errors'
import { createDiscovery } from '../discoveryService'
import {
  addSiteTargets,
  createSite,
  deleteSite,
  getSite,
  listSites,
  loadSiteWithHeaders,
  updateSite,
  type SiteServiceDeps,
} from '../siteService'
import { SiteInputSchema } from '#shared/schemas/site'

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const base = SiteInputSchema.parse({
  name: 'shop',
  frontBaseUrl: 'http://localhost:3001/',
  nucleiPaths: '/\n/api/products',
})
let deps: SiteServiceDeps
let n = 0

beforeEach(() => {
  deps = {
    db: openDatabase({ file: ':memory:', migrationsFolder }),
    cipher: createSiteCipher(randomBytes(32).toString('base64')),
    now: () => new Date('2026-01-01T00:00:00Z'),
    id: () => `id-${++n}`,
  }
})

describe('siteService', () => {
  it('creates a site, strips trailing slash, never exposes header values', () => {
    const s = createSite(deps, { ...base, headers: [{ name: 'Cookie', value: 'secret=1' }] })
    expect(s.frontBaseUrl).toBe('http://localhost:3001')
    expect(s.headerNames).toEqual(['Cookie'])
    expect(JSON.stringify(s)).not.toContain('secret=1')
    expect(loadSiteWithHeaders(deps, s.id)?.headers).toEqual([
      { name: 'Cookie', value: 'secret=1' },
    ])
  })

  it('update keeps headers when omitted and clears them with []', () => {
    const s = createSite(deps, { ...base, headers: [{ name: 'Cookie', value: 'v' }] })
    expect(updateSite(deps, s.id, { ...base, name: 'renamed' }).headerNames).toEqual(['Cookie'])
    expect(updateSite(deps, s.id, { ...base, headers: [] }).headerNames).toEqual([])
    expect(loadSiteWithHeaders(deps, s.id)?.headers).toEqual([])
  })

  it('seals browser storage like headers: names exposed, values write-only, [] clears', () => {
    const storage = [
      { kind: 'localStorage' as const, name: 'token', value: 'eyJ.secret' },
      { kind: 'sessionStorage' as const, name: 'bid', value: '6' },
    ]
    const s = createSite(deps, { ...base, browserStorage: storage })
    expect(s.browserStorageNames).toEqual([
      { kind: 'localStorage', name: 'token' },
      { kind: 'sessionStorage', name: 'bid' },
    ])
    expect(JSON.stringify(s)).not.toContain('eyJ.secret')
    expect(loadSiteWithHeaders(deps, s.id)?.browserStorage).toEqual(storage)
    // omitted → kept; [] → cleared
    expect(updateSite(deps, s.id, { ...base, name: 'renamed' }).browserStorageNames).toHaveLength(2)
    expect(loadSiteWithHeaders(deps, s.id)?.browserStorage).toEqual(storage)
    expect(updateSite(deps, s.id, { ...base, browserStorage: [] }).browserStorageNames).toEqual([])
    expect(loadSiteWithHeaders(deps, s.id)?.browserStorage).toEqual([])
  })

  it('lists with lastScan null, gets, deletes', async () => {
    const s = createSite(deps, base)
    expect(listSites(deps.db)[0]).toMatchObject({
      id: s.id,
      lastScan: null,
      requiresConfirmation: false,
    })
    expect(getSite(deps.db, s.id)?.name).toBe('shop')
    expect(await deleteSite(deps.db, s.id)).toBe(true)
    expect(getSite(deps.db, s.id)).toBeNull()
  })

  it('update of unknown id throws ServiceError 404', () => {
    expect(() => updateSite(deps, 'nope', base)).toThrow(/not found/)
  })

  it('deleting a site best-effort removes its scan and discovery artifact directories (I5)', async () => {
    const s = createSite(deps, base)
    const scan = createScan(deps.db, { now: deps.now, id: deps.id }, s.id, ['nuclei'])
    const scansDir = mkdtempSync(join(tmpdir(), 'sakuda-scans-'))
    const scanDir = join(scansDir, scan.id)
    mkdirSync(join(scanDir, 'nuclei'), { recursive: true })
    writeFileSync(join(scanDir, 'nuclei', 'findings.jsonl'), '{}')
    const logger = pino({ level: 'silent' })

    // one job at a time per site: finish the scan before queueing a discovery
    deps.db.update(scans).set({ status: 'done' }).where(eq(scans.id, scan.id)).run()
    const discovery = createDiscovery(deps.db, { now: deps.now, id: deps.id }, s.id)
    const discoveriesDir = mkdtempSync(join(tmpdir(), 'sakuda-discoveries-'))
    const discoveryDir = join(discoveriesDir, discovery.id)
    mkdirSync(discoveryDir, { recursive: true })
    writeFileSync(join(discoveryDir, 'site-tree.jsonl'), '')

    expect(await deleteSite(deps.db, s.id, { scansDir, discoveriesDir, logger })).toBe(true)

    expect(existsSync(scanDir)).toBe(false)
    expect(existsSync(discoveryDir)).toBe(false)
  })

  it('deleting a site logs (never throws) when an artifact directory cannot be removed', async () => {
    const s = createSite(deps, base)
    createScan(deps.db, { now: deps.now, id: deps.id }, s.id, ['nuclei'])
    const logger = pino({ level: 'silent' })
    let warned = false
    logger.warn = ((...args: unknown[]) => {
      warned = true
      return args
    }) as typeof logger.warn

    // scansDir points at a path that cannot contain the scan subdirectory
    // (its parent is a file, not a directory) so `rm` fails.
    const notADir = mkdtempSync(join(tmpdir(), 'sakuda-notadir-'))
    writeFileSync(join(notADir, 'blocker'), '')
    const scansDir = join(notADir, 'blocker')

    await expect(
      deleteSite(deps.db, s.id, { scansDir, discoveriesDir: scansDir, logger }),
    ).resolves.toBe(true)
    expect(warned).toBe(true)
  })

  describe('addSiteTargets', () => {
    it('appends new lines, skips duplicates, and bumps updatedAt', () => {
      const s = createSite(deps, base) // nucleiPaths: '/\n/api/products'
      deps.now = () => new Date('2026-02-01T00:00:00Z')
      const r = addSiteTargets(deps, s.id, [
        '/api/products',
        '/login',
        'api:/v1'.replace('api:', ''),
      ])
      expect(r.added).toEqual(['/login', '/v1'])
      expect(r.skipped).toEqual(['/api/products'])
      expect(r.site.nucleiPaths).toBe('/\n/api/products\n/login\n/v1\n')
      expect(r.site.updatedAt).toBe('2026-02-01T00:00:00.000Z')
      expect(getSite(deps.db, s.id)?.nucleiPaths).toBe('/\n/api/products\n/login\n/v1\n')
    })

    it('is a no-op (no updatedAt bump) when every line is already present', () => {
      const s = createSite(deps, base)
      deps.now = () => new Date('2026-02-01T00:00:00Z')
      const r = addSiteTargets(deps, s.id, ['/'])
      expect(r.added).toEqual([])
      expect(r.site.updatedAt).toBe(s.updatedAt)
    })

    it('rejects invalid lines with 422 and writes nothing', () => {
      const s = createSite(deps, base)
      expect(() => addSiteTargets(deps, s.id, ['/ok', 'http://x.example/abs'])).toThrow(
        ServiceError,
      )
      try {
        addSiteTargets(deps, s.id, ['/ok', 'http://x.example/abs'])
      } catch (e) {
        if (!(e instanceof ServiceError)) throw e
        expect(e.statusCode).toBe(422)
        expect(e.details).toEqual({ invalid: ['http://x.example/abs'] })
      }
      expect(getSite(deps.db, s.id)?.nucleiPaths).toBe(base.nucleiPaths)
    })

    it('rejects api: lines when the site has no apiBaseUrl', () => {
      const s = createSite(deps, base)
      expect(() => addSiteTargets(deps, s.id, ['api:/v1/users'])).toThrow(/apiBaseUrl/)
      expect(
        addSiteTargets(
          deps,
          createSite(deps, { ...base, apiBaseUrl: 'http://localhost:8080' }).id,
          ['api:/v1/users'],
        ).added,
      ).toEqual(['api:/v1/users'])
    })

    it('rejects a save that would push nucleiPaths over the site schema limit (site stays editable)', () => {
      const s = createSite(deps, base)
      const huge = Array.from({ length: 400 }, (_, i) => `/p${i}/${'x'.repeat(60)}`)
      expect(() => addSiteTargets(deps, s.id, huge)).toThrow(/over the 20000 limit/)
      expect(getSite(deps.db, s.id)?.nucleiPaths).toBe(base.nucleiPaths)
      // the form's schema must still accept the untouched site
      expect(
        SiteInputSchema.safeParse({ ...base, nucleiPaths: getSite(deps.db, s.id)?.nucleiPaths })
          .success,
      ).toBe(true)
    })

    it('throws 404 for an unknown site', () => {
      expect(() => addSiteTargets(deps, 'nope', ['/'])).toThrow(/not found/)
    })
  })
})
