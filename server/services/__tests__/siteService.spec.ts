import { beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { openDatabase } from '../../db/client'
import { createHeaderCipher } from '../../domain/headerCipher'
import { createScan } from '../scanService'
import {
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
    cipher: createHeaderCipher(randomBytes(32).toString('base64')),
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

  it('deleting a site best-effort removes its scans artifact directories (I5)', async () => {
    const s = createSite(deps, base)
    const scan = createScan(deps.db, { now: deps.now, id: deps.id }, s.id, ['nuclei'])
    const scansDir = mkdtempSync(join(tmpdir(), 'sakuda-scans-'))
    const scanDir = join(scansDir, scan.id)
    mkdirSync(join(scanDir, 'nuclei'), { recursive: true })
    writeFileSync(join(scanDir, 'nuclei', 'findings.jsonl'), '{}')
    const logger = pino({ level: 'silent' })

    expect(await deleteSite(deps.db, s.id, { scansDir, logger })).toBe(true)

    expect(existsSync(scanDir)).toBe(false)
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

    await expect(deleteSite(deps.db, s.id, { scansDir, logger })).resolves.toBe(true)
    expect(warned).toBe(true)
  })
})
