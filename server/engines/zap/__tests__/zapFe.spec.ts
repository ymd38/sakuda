import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import YAML from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseEnv, type Env } from '../../../config/env'
import type { SiteWithHeaders } from '../../../services/siteService'
import { EngineError } from '../../types'
import { runZapFe } from '../zapFe'
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
    excludePaths: '',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: false,
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

describe('runZapFe', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-zapfe-'))
  })

  it('runs the fake zap.sh and normalizes 2 high findings from the fixture', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({ headers: [{ name: 'Cookie', value: 'a=b' }], headerNames: ['Cookie'] })

    const out = await runZapFe({
      scanId: 'scan-1',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(out.counts.high).toBe(2)
    expect(out.meta.zapVersion).toBe('2.17.0')
    expect(out.meta.seedUrl).toBe('http://localhost:3000/')
    expect(out.meta.spider).toBe('traditional + ajax')
    // findings' urls are un-aliased back from host.docker.internal to the real host
    expect(out.findings.every((f) => f.url.includes('localhost:3000'))).toBe(true)
    expect(out.findings.some((f) => f.url.includes('host.docker.internal'))).toBe(false)

    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: plan is Record<string, unknown> at runtime; narrow just enough to assert the spider url
    const jobs = (plan as { jobs: Array<{ type: string; parameters: Record<string, unknown> }> })
      .jobs
    const spider = jobs.find((j) => j.type === 'spider')
    expect(spider?.parameters.url).toBe('http://host.docker.internal:3000/')
  })

  it('adds the seed-path warning when zapFeSeedPath was not among reached URLs', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({
      headers: [{ name: 'Cookie', value: 'a=b' }],
      headerNames: ['Cookie'],
      browserStorageNames: [],
      zapFeSeedPath: '/dash',
      discoverySeedPaths: '',
    })

    const out = await runZapFe({
      scanId: 'scan-2',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(out.warnings.some((w) => w.includes('seed path /dash was not among reached URLs'))).toBe(
      true,
    )
  })

  it('registers the browser-storage selenium script when the site has storage items, and removes it after', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({
      browserStorage: [{ kind: 'localStorage', name: 'token', value: 'eyJ.secret' }],
      browserStorageNames: [{ kind: 'localStorage', name: 'token' }],
    })

    const out = await runZapFe({
      scanId: 'scan-4',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(JSON.parse(readFileSync(join(workDir, 'secret-mode.json'), 'utf8'))).toBe(0o600)
    expect(existsSync(join(workDir, 'browser-storage.js'))).toBe(false)
    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: narrow just enough to find the selenium jobs
    const jobs = (plan as { jobs: Array<{ type: string; parameters: Record<string, unknown> }> })
      .jobs
    expect(
      jobs.filter((j) => j.parameters.type === 'selenium').map((j) => j.parameters.action),
    ).toEqual(['add', 'enable'])
    expect(out.meta.browserStorage).toEqual(['localStorage:token'])
    expect(JSON.stringify(out)).not.toContain('eyJ.secret')
  })

  it('throws EngineError when zap.sh produces no report', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    process.env.FAKE_ZAP_NO_REPORT = '1'
    try {
      await expect(
        runZapFe({
          scanId: 'scan-3',
          engine: 'zap-fe',
          site: baseSite(),
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
