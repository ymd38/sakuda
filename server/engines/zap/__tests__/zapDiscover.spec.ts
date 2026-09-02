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
import { runZapDiscover } from '../zapDiscover'
import { writeFakeZap } from './fakeZap'

const FIXTURE = join(__dirname, 'fixtures', 'site-tree.jsonl')
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
    excludePaths: '/admin/*',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: false,
    allowMutatingRequests: false,
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

interface PlanShape {
  env: { contexts: Array<{ includePaths: string[] }> }
  jobs: Array<{ type: string; parameters: Record<string, unknown> }>
}

describe('runZapDiscover', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-discover-'))
  })

  it('runs the fake zap.sh with a crawl-only plan and normalizes the site-tree dump', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({ headers: [{ name: 'Cookie', value: 'a=b' }], headerNames: ['Cookie'] })

    const out = await runZapDiscover({
      discoveryId: 'disc-1',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    // Un-aliased back to the real host; deduped; assets / noise / excluded /
    // off-origin dropped; a 401 is kept (it is a real endpoint) but flagged.
    expect(out.urls).toEqual([
      { url: 'http://localhost:3000/', method: 'GET', statusCode: 200, source: 'spider' },
      {
        url: 'http://localhost:3000/api/Challenges/?name=Score%20Board',
        method: 'GET',
        statusCode: 200,
        source: 'spider',
      },
      {
        url: 'http://localhost:3000/rest/products/search?q=',
        method: 'GET',
        statusCode: 200,
        source: 'ajax',
      },
      {
        url: 'http://localhost:3000/rest/basket/6',
        method: 'GET',
        statusCode: 401,
        source: 'ajax',
      },
    ])
    expect(out.meta).toMatchObject({
      seedUrls: ['http://localhost:3000/'],
      browserStorage: [],
      spider: 'traditional + ajax',
      nodeCount: 12,
      structuralCount: 2,
      urlCount: 4,
      dropped: { invalid: 0, sameOriginOnly: 1, asset: 1, noise: 2, excluded: 1, capped: 0 },
      authFailureCount: 1,
      timedOut: false,
    })
    expect(out.warnings).toEqual([
      '1 request(s) got 401/403 — headers may be missing or expired',
      '1 unparsable line(s) in the site-tree dump were ignored',
    ])

    // The plan is crawl-only (no report job) and references the script we wrote.
    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: plan is Record<string, unknown> at runtime; narrow just enough to assert the job list
    const { env: planEnv, jobs } = plan as PlanShape
    expect(jobs.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'script',
      'script',
    ])
    expect(jobs[0]?.parameters).toEqual({ disableAllRules: true })
    expect(jobs[1]?.parameters.url).toBe('http://host.docker.internal:3000/')
    expect(jobs[3]?.parameters.file).toBe(join(workDir, 'dump-site-tree.js'))
    expect(planEnv.contexts[0]?.includePaths).toEqual([
      '^http:\\/\\/host\\.docker\\.internal:3000(/.*)?$',
    ])
    const script = readFileSync(join(workDir, 'dump-site-tree.js'), 'utf8')
    expect(script).toContain(JSON.stringify(join(workDir, 'site-tree.jsonl')))
    // Header values never linger on disk after the run.
    expect(existsSync(join(workDir, 'replacer.conf'))).toBe(false)
  })

  it("tells the Ajax spider's Firefox to treat the localhost alias as a secure context", async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')

    await runZapDiscover({
      discoveryId: 'disc-1',
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
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')

    await runZapDiscover({
      discoveryId: 'disc-1',
      site: baseSite(),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const argv = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8')) as string[]
    expect(argv).not.toContain('-config')
  })

  it('also scopes the crawl to the api base URL when one is set', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')

    await runZapDiscover({
      discoveryId: 'disc-2',
      site: baseSite({ apiBaseUrl: 'http://localhost:8080' }),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: see above
    const { env: planEnv } = plan as PlanShape
    expect(planEnv.contexts[0]?.includePaths).toEqual([
      '^http:\\/\\/localhost:3000(/.*)?$',
      '^http:\\/\\/localhost:8080(/.*)?$',
    ])
  })

  it('with browser storage + several seeds: writes the selenium script 0600 for the run only, registers it, and crawls every seed', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const site = baseSite({
      discoverySeedPaths: '/#/\n/#/basket',
      browserStorage: [
        { kind: 'localStorage', name: 'token', value: 'eyJ.secret' },
        { kind: 'sessionStorage', name: 'bid', value: '6' },
      ],
      browserStorageNames: [
        { kind: 'localStorage', name: 'token' },
        { kind: 'sessionStorage', name: 'bid' },
      ],
    })

    const out = await runZapDiscover({
      discoveryId: 'disc-5',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    // secret script existed with mode 0600 while ZAP ran, and is gone afterwards
    expect(JSON.parse(readFileSync(join(workDir, 'secret-mode.json'), 'utf8'))).toBe(0o600)
    expect(existsSync(join(workDir, 'browser-storage.js'))).toBe(false)
    const plan: unknown = YAML.parse(readFileSync(join(workDir, 'plan.yaml'), 'utf8'))
    // as: see above
    const { jobs } = plan as PlanShape
    expect(jobs[1]?.parameters).toMatchObject({ action: 'add', type: 'selenium' })
    expect(jobs[1]?.parameters.file).toBe(join(workDir, 'browser-storage.js'))
    expect(jobs[2]?.parameters).toMatchObject({ action: 'enable', type: 'selenium' })
    expect(jobs.filter((j) => j.type === 'spiderAjax').map((j) => j.parameters.url)).toEqual([
      'http://localhost:3000/#/',
      'http://localhost:3000/#/basket',
    ])
    expect(out.meta).toMatchObject({
      seedUrls: ['http://localhost:3000/#/', 'http://localhost:3000/#/basket'],
      browserStorage: ['localStorage:token', 'sessionStorage:bid'],
    })
    // the secret value never reaches meta / warnings
    expect(JSON.stringify(out)).not.toContain('eyJ.secret')
  })

  it('throws EngineError when zap.sh produces no site-tree dump', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    process.env.FAKE_ZAP_NO_REPORT = '1'
    try {
      await expect(
        runZapDiscover({
          discoveryId: 'disc-3',
          site: baseSite(),
          workDir: join(tmp, 'work'),
          env,
          logger,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(EngineError)
    } finally {
      delete process.env.FAKE_ZAP_NO_REPORT
    }
  })

  it('warns when the crawl requested nothing at all', async () => {
    const empty = join(tmp, 'empty.jsonl')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(empty, '')
    const fakeBin = writeFakeZap(tmp, empty, 'fake-zap.js', 'site-tree.jsonl')
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_ZAP_CMD: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })

    const out = await runZapDiscover({
      discoveryId: 'disc-4',
      site: baseSite(),
      workDir: join(tmp, 'work'),
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(out.urls).toEqual([])
    expect(out.warnings[0]).toContain('the crawl requested no URLs')
  })
})
