import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

// Must be set before `setup()` boots the server subprocess: it inherits
// process.env, and the app validates these at startup (server/config/env.ts).
process.env.SAKUDA_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const dataDir = await mkdtemp(join(tmpdir(), 'sakuda-e2e-'))
process.env.SAKUDA_DATA_DIR = dataDir
// Keep the queue from ever running a real scan — these tests only assert on
// API-level state transitions (queued/409/etc.), not engine execution.
process.env.SAKUDA_JOB_RUNNER = 'off'

await setup({ server: true })

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function requireId(v: unknown): string {
  if (!isRecord(v) || typeof v.id !== 'string')
    throw new Error(`expected an object with id, got ${JSON.stringify(v)}`)
  return v.id
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('api e2e', () => {
  const cookieValue = 'super-secret-cookie-value-123456'
  let siteId: string
  let scanId: string

  it('POST /api/sites creates a site and never echoes header values', async () => {
    const res = await postJson('/api/sites', {
      name: 'Local target',
      frontBaseUrl: 'http://localhost:39991',
      nucleiPaths: '/',
      headers: [{ name: 'Cookie', value: cookieValue }],
    })
    expect(res.status).toBe(201)
    const site: unknown = await res.json()
    expect(site).toMatchObject({ headerNames: ['Cookie'] })
    expect(JSON.stringify(site)).not.toContain(cookieValue)
    siteId = requireId(site)
  })

  it('GET /api/sites lists the created site with no scan yet', async () => {
    const res = await fetch('/api/sites')
    expect(res.status).toBe(200)
    const sites: unknown = await res.json()
    expect(Array.isArray(sites)).toBe(true)
    expect(sites).toHaveLength(1)
    expect(sites).toMatchObject([{ id: siteId, lastScan: null }])
  })

  it('POST /api/sites/:id/scans queues a nuclei-only scan', async () => {
    const res = await postJson(`/api/sites/${siteId}/scans`, { engines: ['nuclei'] })
    expect(res.status).toBe(202)
    const scan: unknown = await res.json()
    expect(scan).toMatchObject({ status: 'queued' })
    scanId = requireId(scan)
  })

  it('a second POST while one is active is rejected', async () => {
    const res = await postJson(`/api/sites/${siteId}/scans`, { engines: ['nuclei'] })
    expect(res.status).toBe(409)
  })

  it('GET /api/scans/:id reports queued status', async () => {
    const res = await fetch(`/api/scans/${scanId}`)
    expect(res.status).toBe(200)
    const scan: unknown = await res.json()
    expect(scan).toMatchObject({ status: 'queued' })
  })

  it('GET /api/scans/:id/report.md is rejected before the scan finishes', async () => {
    const res = await fetch(`/api/scans/${scanId}/report.md`)
    expect(res.status).toBe(409)
  })

  it('POST /api/sites with a non-JSON content-type is rejected with 415 (I7)', async () => {
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        name: 'Cross-origin form',
        frontBaseUrl: 'http://localhost:39992',
        nucleiPaths: '/',
      }),
    })
    expect(res.status).toBe(415)
  })

  it('a non-local site without nonLocalConfirmed is rejected with a nonLocalConfirmed issue', async () => {
    const res = await postJson('/api/sites', {
      name: 'Remote target',
      frontBaseUrl: 'https://example.com',
      nucleiPaths: '/',
    })
    expect(res.status).toBe(422)
    const body: unknown = await res.json()
    expect(JSON.stringify(body)).toContain('nonLocalConfirmed')
  })
})
