import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type Db } from '../../db/client'
import { scans } from '../../db/schema'
import { parseEnv, type Env } from '../../config/env'
import { createHeaderCipher } from '../../domain/headerCipher'
import type { EngineOutput, EngineRunner } from '../../engines/types'
import { logger } from '../../lib/logger'
import { createSite, type SiteServiceDeps } from '../siteService'
import { createScan } from '../scanService'
import { createJobLoop } from '../jobLoop'
import { SiteInputSchema } from '#shared/schemas/site'
import { emptyCounts } from '#shared/utils/severity'
import type { Engine } from '#shared/types/api'

// Real timers + a short pollMs, per the task brief: deterministic without the
// fragility of interleaving fake timers with the loop's async tick chain.

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const base = SiteInputSchema.parse({
  name: 'shop',
  frontBaseUrl: 'http://localhost:3001/',
  nucleiPaths: '/',
})

let db: Db
let env: Env
let siteDeps: SiteServiceDeps
let n = 0
const now = () => new Date('2026-02-01T00:00:00.000Z')
const id = () => `id-${++n}`

function successOutput(): EngineOutput {
  return { findings: [], counts: emptyCounts(), meta: {}, warnings: [], exitCode: 0, signal: null }
}

let loops: { stop(): Promise<void> }[] = []

beforeEach(() => {
  n = 0
  loops = []
  db = openDatabase({ file: ':memory:', migrationsFolder })
  env = parseEnv({
    SAKUDA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SAKUDA_DATA_DIR: mkdtempSync(join(tmpdir(), 'sakuda-jobloop-')),
  })
  siteDeps = { db, cipher: createHeaderCipher(env.encryptionKey), now, id: randomUUID }
})

afterEach(async () => {
  await Promise.all(loops.map((l) => l.stop()))
})

function makeLoop(runners: Partial<Record<Engine, EngineRunner>>) {
  const full: Record<Engine, EngineRunner> = {
    nuclei: vi.fn(async () => successOutput()),
    'zap-api': vi.fn(async () => successOutput()),
    'zap-fe': vi.fn(async () => successOutput()),
    ...runners,
  }
  const loop = createJobLoop({
    db,
    env,
    cipher: siteDeps.cipher,
    runners: full,
    logger,
    now,
    id,
    pollMs: 10,
  })
  loops.push(loop)
  return { loop, runners: full }
}

describe('createJobLoop', () => {
  it('picks up a queued scan and finishes it', async () => {
    const site = createSite(siteDeps, base)
    const scan = createScan(db, { now, id }, site.id, ['nuclei'])
    const { loop } = makeLoop({})

    loop.start()
    await vi.waitFor(
      () => {
        const row = db.select().from(scans).where(eq(scans.id, scan.id)).get()
        expect(row?.status).toBe('done')
      },
      { timeout: 2000, interval: 5 },
    )

    await loop.stop()
  })

  it('aborts a scan that is running when stop() is called', async () => {
    const site = createSite(siteDeps, base)
    const scan = createScan(db, { now, id }, site.id, ['nuclei'])
    const hangingRunner: EngineRunner = vi.fn(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(new Error('aborted'))
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const { loop, runners } = makeLoop({ nuclei: hangingRunner })

    loop.start()
    await vi.waitFor(() => expect(runners.nuclei).toHaveBeenCalled(), {
      timeout: 2000,
      interval: 5,
    })
    expect(loop.isBusy()).toBe(true)

    await loop.stop()

    expect(loop.isBusy()).toBe(false)
    const row = db.select().from(scans).where(eq(scans.id, scan.id)).get()
    expect(row?.status).toBe('failed')
    expect(row?.error).toBe('aborted: server shutting down')
  })
})
