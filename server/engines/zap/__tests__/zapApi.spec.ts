import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import YAML from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseEnv, type Env } from '../../../config/env'
import type { SiteWithHeaders } from '../../../services/siteService'
import { EngineError } from '../../types'
import { runZapApi } from '../zapApi'
import { writeFakeZap } from './fakeZap'

const FIXTURE = join(__dirname, 'fixtures', 'zap-report.json')
const key = randomBytes(32).toString('base64')
const logger = pino({ level: 'silent' })

function baseSite(overrides: Partial<SiteWithHeaders> = {}): SiteWithHeaders {
  return {
    id: 'site-1',
    name: 'shop',
    frontBaseUrl: 'http://localhost:3000',
    apiBaseUrl: null,
    nucleiPaths: '',
    openapiUrl: null,
    openapiJson: null,
    zapFeSeedPath: '/',
    discoverySeedPaths: '',
    crawlScopePaths: '',
    excludePaths: '',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: false,
    allowMutatingRequests: false,
    nucleiEnabledRiskTags: [],
    headerNames: [],
    browserStorageNames: [],
    requiresConfirmation: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    headers: [],
    browserStorage: [],
    ...overrides,
  }
}

function makeEnv(overrides: Record<string, string> = {}, fakeBin: string, tmp: string): Env {
  return parseEnv({
    SAKUDA_ENCRYPTION_KEY: key,
    SAKUDA_ZAP_CMD: fakeBin,
    SAKUDA_DATA_DIR: tmp,
    SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    ...overrides,
  })
}

describe('runZapApi', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-zapapi-'))
  })

  it('throws EngineError when neither openapiUrl nor openapiJson is set', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin, tmp)
    const workDir = join(tmp, 'work')
    await expect(
      runZapApi({
        scanId: 'scan-1',
        engine: 'zap-api',
        site: baseSite(),
        workDir,
        env,
        logger,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/requires openapiUrl or openapiJson/)
  })

  it('writes openapi.json for pasted JSON and references it via apiFile in the plan', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin, tmp)
    const workDir = join(tmp, 'work')
    const openapiJson = JSON.stringify({ openapi: '3.0.0', info: { title: 't' }, paths: {} })
    const site = baseSite({ openapiJson })

    const out = await runZapApi({
      scanId: 'scan-2',
      engine: 'zap-api',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(readFileSync(join(workDir, 'openapi.json'), 'utf8')).toBe(openapiJson)
    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: plan is Record<string, unknown> at runtime; narrow just enough to assert the openapi job
    const jobs = (plan as { jobs: Array<{ type: string; parameters: Record<string, unknown> }> })
      .jobs
    const openapiJob = jobs.find((j) => j.type === 'openapi')
    expect(openapiJob?.parameters.apiFile).toBe(join(workDir, 'openapi.json'))
    expect(out.meta.openapiSource).toBe('pasted')
    expect(out.meta.targetUrl).toBe('http://localhost:3000')
  })

  it('uses apiUrl (aliased) when openapiUrl is a URL', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin, tmp)
    const workDir = join(tmp, 'work')
    const site = baseSite({ openapiUrl: 'http://localhost:3000/openapi.json' })

    const out = await runZapApi({
      scanId: 'scan-3',
      engine: 'zap-api',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: plan is Record<string, unknown> at runtime; narrow just enough to assert the openapi job
    const jobs = (plan as { jobs: Array<{ type: string; parameters: Record<string, unknown> }> })
      .jobs
    const openapiJob = jobs.find((j) => j.type === 'openapi')
    expect(openapiJob?.parameters.apiUrl).toBe('http://host.docker.internal:3000/openapi.json')
    expect(out.meta.openapiSource).toBe('url')
    // No browser is launched for an API scan, so no Firefox pref (-config) is passed.
    const argv = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8')) as string[]
    expect(argv).not.toContain('-config')
  })

  it('throws EngineError when zap.sh produces no report', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin, tmp)
    const workDir = join(tmp, 'work')
    const site = baseSite({ openapiUrl: 'http://localhost:3000/openapi.json' })
    process.env.FAKE_ZAP_NO_REPORT = '1'
    try {
      await expect(
        runZapApi({
          scanId: 'scan-4',
          engine: 'zap-api',
          site,
          workDir,
          env,
          logger,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(EngineError)
    } finally {
      delete process.env.FAKE_ZAP_NO_REPORT
    }
  })
})
