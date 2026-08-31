import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { openDatabase, type Db } from '../../db/client'
import { discoveries, sites } from '../../db/schema'
import { parseEnv, type Env } from '../../config/env'
import { createSiteCipher } from '../../domain/headerCipher'
import { EngineError, type DiscoverOutput, type DiscoverRunner } from '../../engines/types'
import { logger } from '../../lib/logger'
import { createSite, type SiteServiceDeps } from '../siteService'
import { claimNextQueuedDiscovery, createDiscovery, getDiscovery } from '../discoveryService'
import { runDiscovery, type DiscoveryRunnerDeps } from '../discoveryRunner'
import { SiteInputSchema } from '#shared/schemas/site'

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const base = SiteInputSchema.parse({ name: 'shop', frontBaseUrl: 'http://localhost:3001/' })

let db: Db
let env: Env
let siteDeps: SiteServiceDeps
let n = 0
const now = () => new Date('2026-02-01T00:00:00.000Z')
const id = () => `id-${++n}`
const tmpDataDirs: string[] = []

afterAll(async () => {
  await Promise.all(tmpDataDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

function output(overrides: Partial<DiscoverOutput> = {}): DiscoverOutput {
  return {
    urls: [{ url: 'http://localhost:3001/a', method: 'GET', statusCode: 200, source: 'spider' }],
    meta: { urlCount: 1 },
    warnings: ['w'],
    exitCode: 0,
    signal: null,
    ...overrides,
  }
}

function makeDeps(discover: DiscoverRunner): DiscoveryRunnerDeps {
  return { db, env, cipher: siteDeps.cipher, discover, logger, now, id }
}

beforeEach(() => {
  n = 0
  db = openDatabase({ file: ':memory:', migrationsFolder })
  const dataDir = mkdtempSync(join(tmpdir(), 'sakuda-discoveryrunner-'))
  tmpDataDirs.push(dataDir)
  env = parseEnv({
    SAKUDA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SAKUDA_DATA_DIR: dataDir,
  })
  siteDeps = { db, cipher: createSiteCipher(env.encryptionKey), now, id: randomUUID }
})

function queueAndClaim(siteId: string): string {
  const d = createDiscovery(db, { now, id }, siteId)
  claimNextQueuedDiscovery(db, now)
  return d.id
}

describe('runDiscovery', () => {
  it('stores urls, meta and warnings and marks the discovery done', async () => {
    const site = createSite(siteDeps, base)
    const discoveryId = queueAndClaim(site.id)
    const discover = vi.fn(async () => output())

    await runDiscovery(makeDeps(discover), discoveryId, new AbortController().signal)

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryId,
        workDir: join(env.discoveriesDir, discoveryId),
        site: expect.objectContaining({ id: site.id, headers: [] }),
      }),
    )
    expect(getDiscovery(db, discoveryId)).toMatchObject({
      status: 'done',
      error: null,
      urlCount: 1,
      urls: [{ url: 'http://localhost:3001/a' }],
      meta: { urlCount: 1 },
      warnings: ['w'],
    })
    expect(getDiscovery(db, discoveryId)?.finishedAt).not.toBeNull()
  })

  it('marks the discovery failed with the runbook when the engine throws', async () => {
    const site = createSite(siteDeps, base)
    const discoveryId = queueAndClaim(site.id)
    const deps = makeDeps(
      vi.fn(async () => {
        throw new EngineError('boom', 'check the runbook')
      }),
    )

    await runDiscovery(deps, discoveryId, new AbortController().signal)

    expect(getDiscovery(db, discoveryId)).toMatchObject({
      status: 'failed',
      error: 'boom\nRunbook: check the runbook',
      urlCount: 0,
    })
  })

  it('fails immediately with "aborted" when the signal is already aborted', async () => {
    const site = createSite(siteDeps, base)
    const discoveryId = queueAndClaim(site.id)
    const discover = vi.fn(async () => output())
    const ac = new AbortController()
    ac.abort()

    await runDiscovery(makeDeps(discover), discoveryId, ac.signal)

    expect(discover).not.toHaveBeenCalled()
    expect(getDiscovery(db, discoveryId)).toMatchObject({
      status: 'failed',
      error: 'aborted: server shutting down',
    })
  })

  it('fails the discovery when the site was deleted before it started', async () => {
    const site = createSite(siteDeps, base)
    const discoveryId = queueAndClaim(site.id)
    db.run(sql`PRAGMA foreign_keys = OFF`)
    db.delete(sites).where(eq(sites.id, site.id)).run()
    db.run(sql`PRAGMA foreign_keys = ON`)

    await runDiscovery(
      makeDeps(vi.fn(async () => output())),
      discoveryId,
      new AbortController().signal,
    )

    expect(getDiscovery(db, discoveryId)).toMatchObject({
      status: 'failed',
      error: 'site was deleted before the discovery started',
    })
  })

  it('never leaves the row running when loading the site throws', async () => {
    const site = createSite(siteDeps, { ...base, headers: [{ name: 'Cookie', value: 'a=b' }] })
    const discoveryId = queueAndClaim(site.id)
    const deps = makeDeps(vi.fn(async () => output()))
    deps.cipher = {
      ...siteDeps.cipher,
      headers: {
        seal: siteDeps.cipher.headers.seal,
        open: () => {
          throw new Error('decryption failed')
        },
      },
    }

    await runDiscovery(deps, discoveryId, new AbortController().signal)

    const row = db.select().from(discoveries).where(eq(discoveries.id, discoveryId)).get()
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('discovery runner crashed')
    expect(row?.error).toContain('decryption failed')
  })

  it('returns without touching the db when the row is gone', async () => {
    await expect(
      runDiscovery(makeDeps(vi.fn(async () => output())), 'missing', new AbortController().signal),
    ).resolves.toBeUndefined()
  })
})
