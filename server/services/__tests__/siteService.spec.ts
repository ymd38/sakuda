import { beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { openDatabase } from '../../db/client'
import { createHeaderCipher } from '../../domain/headerCipher'
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

  it('lists with lastScan null, gets, deletes', () => {
    const s = createSite(deps, base)
    expect(listSites(deps.db)[0]).toMatchObject({
      id: s.id,
      lastScan: null,
      requiresConfirmation: false,
    })
    expect(getSite(deps.db, s.id)?.name).toBe('shop')
    expect(deleteSite(deps.db, s.id)).toBe(true)
    expect(getSite(deps.db, s.id)).toBeNull()
  })

  it('update of unknown id throws ServiceError 404', () => {
    expect(() => updateSite(deps, 'nope', base)).toThrow(/not found/)
  })
})
