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
    // default: passive only — no activeScan job, and the report says so
    expect(jobs.some((j) => j.type === 'activeScan')).toBe(false)
    expect(out.meta.activeScan).toBe(false)
    expect(out.meta).not.toHaveProperty('activeScanMaxMinutes')
  })

  // as: plan.yaml is Record<string, unknown> at runtime; narrow just enough to list the jobs
  const readPlanJobs = (workDir: string) =>
    (
      YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8')) as {
        jobs: Array<{
          type: string
          parameters: Record<string, unknown>
          requests?: Array<{ url: string; method: string }>
        }>
      }
    ).jobs

  it('adds the activeScan job (capped by zapApiMaxMinutes) when the site opted into active checks', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({ allowMutatingRequests: true, zapApiMaxMinutes: 30 })

    const out = await runZapFe({
      scanId: 'scan-5',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const jobs = readPlanJobs(workDir)
    expect(jobs.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'activeScan',
      'passiveScan-wait',
      'report',
      'report',
    ])
    expect(jobs[3]?.parameters.maxScanDurationInMins).toBe(30)
    expect(out.meta.activeScan).toBe(true)
    expect(out.meta.activeScanMaxMinutes).toBe(30)
  })

  it('requests the saved front-origin targets (alias-rewritten, no hash routes) before the active scan', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_ZAP_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({
      apiBaseUrl: 'http://localhost:8080',
      nucleiPaths: '/search?q=\n/#/search?q=\napi:/v1/users\n/login',
      excludePaths: '/login',
      allowMutatingRequests: true,
    })

    const out = await runZapFe({
      scanId: 'scan-6',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const jobs = readPlanJobs(workDir)
    expect(jobs.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'requestor',
      'activeScan',
      'passiveScan-wait',
      'report',
      'report',
    ])
    // active run: the empty query value is seeded like nuclei's targets file
    expect(jobs[3]?.requests).toEqual([
      { url: 'http://host.docker.internal:3000/search?q=1', method: 'GET' },
    ])
    expect(out.meta.targetUrlCount).toBe(1)
  })

  it('passes the saved targets verbatim (no query seeding) on a passive run, and none when the list is empty', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const run = (workDir: string, nucleiPaths: string) =>
      runZapFe({
        scanId: 'scan-7',
        engine: 'zap-fe',
        site: baseSite({ nucleiPaths }),
        workDir,
        env,
        logger,
        signal: new AbortController().signal,
      })

    const passive = await run(join(tmp, 'passive'), '/search?q=')
    const requestor = readPlanJobs(join(tmp, 'passive')).find((j) => j.type === 'requestor')
    expect(requestor?.requests).toEqual([{ url: 'http://localhost:3000/search?q=', method: 'GET' }])
    expect(passive.meta.targetUrlCount).toBe(1)

    const none = await run(join(tmp, 'none'), '')
    expect(readPlanJobs(join(tmp, 'none')).some((j) => j.type === 'requestor')).toBe(false)
    expect(none.meta.targetUrlCount).toBe(0)
  })

  it('keeps the active scan off for an unconfirmed non-local site even when opted in', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({
      frontBaseUrl: 'https://staging.example.test',
      allowMutatingRequests: true,
      requiresConfirmation: true,
      nonLocalConfirmed: false,
    })

    const out = await runZapFe({
      scanId: 'scan-6',
      engine: 'zap-fe',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(readPlanJobs(workDir).some((j) => j.type === 'activeScan')).toBe(false)
    expect(out.meta.activeScan).toBe(false)
  })

  it("tells the Ajax spider's Firefox to treat the localhost alias as a secure context", async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')

    await runZapFe({
      scanId: 'scan-1',
      engine: 'zap-fe',
      site: baseSite(),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const argv = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8')) as string[]
    expect(argv.filter((a) => a.startsWith('selenium.firefoxPrefs.'))).toEqual([
      'selenium.firefoxPrefs.pref(0).name=dom.securecontext.allowlist',
      'selenium.firefoxPrefs.pref(0).value=host.docker.internal',
      'selenium.firefoxPrefs.pref(0).enabled=true',
    ])
  })

  it('sets no Firefox pref when no localhost alias is configured', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')

    await runZapFe({
      scanId: 'scan-1',
      engine: 'zap-fe',
      site: baseSite(),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const argv = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8')) as string[]
    expect(argv).not.toContain('-config')
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
