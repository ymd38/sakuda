import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseEnv, type Env } from '../../../config/env'
import type { SiteWithHeaders } from '../../../services/siteService'
import { EngineError } from '../../types'
import { runNuclei } from '../index'

// Fake nuclei binary: reads the -o output path and -l targets file from
// argv, writes one JSONL "high" finding whose matched-at uses the first
// target's host, prints a nuclei-shaped stats line to stdout, exits 0.
const FAKE_SUCCESS = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
const targetsFile = args[args.indexOf('-l') + 1]
let host = 'localhost'
try {
  const first = fs.readFileSync(targetsFile, 'utf8').trim().split('\\n')[0]
  host = new URL(first).host
} catch {}
const finding = {
  'template-id': 'fake-high',
  info: { name: 'Fake High', severity: 'high' },
  host,
  'matched-at': 'http://' + host + '/a',
}
fs.writeFileSync(outFile, JSON.stringify(finding) + '\\n')
console.log(JSON.stringify({ requests: '10', errors: '0' }))
process.exit(0)
`

const FAKE_FAILURE = `#!/usr/bin/env node
process.exit(2)
`

function writeFakeBin(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  chmodSync(p, 0o755)
  return p
}

const key = randomBytes(32).toString('base64')

function baseSite(overrides: Partial<SiteWithHeaders> = {}): SiteWithHeaders {
  return {
    id: 'site-1',
    name: 'shop',
    frontBaseUrl: 'http://localhost:3001',
    apiBaseUrl: null,
    nucleiPaths: '/a\n/b',
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

describe('runNuclei', () => {
  let tmp: string
  const logger = pino({ level: 'silent' })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-nuclei-'))
  })

  it('runs the fake binary and normalizes its output', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const out = await runNuclei({
      scanId: 'scan-1',
      engine: 'nuclei',
      site: baseSite(),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(out.findings).toHaveLength(1)
    expect(out.counts.high).toBe(1)
    expect(out.meta.urlCount).toBe(2)
    expect(readFileSync(join(workDir, 'targets.txt'), 'utf8')).toBe(
      'http://localhost:3001/a\nhttp://localhost:3001/b\n',
    )
    expect(out.findings[0]!.url).toBe('http://localhost:3001/a')
  })

  it('rewrites loopback host in targets and restores it in finding urls', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal',
    })
    const workDir = join(tmp, 'work')
    const out = await runNuclei({
      scanId: 'scan-1',
      engine: 'nuclei',
      site: baseSite(),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })

    expect(readFileSync(join(workDir, 'targets.txt'), 'utf8')).toContain('host.docker.internal')
    expect(out.findings[0]!.url).toContain('localhost')
    expect(out.findings[0]!.url).not.toContain('host.docker.internal')
  })

  it('throws EngineError when the binary exits non-zero with no output', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei-fail.js', FAKE_FAILURE)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    await expect(
      runNuclei({
        scanId: 'scan-2',
        engine: 'nuclei',
        site: baseSite(),
        workDir,
        env,
        logger,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(EngineError)
  })

  it('throws a clean "aborted" EngineError (not a confusing exit-code diagnosis) when the signal is already aborted (I6)', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    const ac = new AbortController()
    ac.abort()
    await expect(
      runNuclei({
        scanId: 'scan-4',
        engine: 'nuclei',
        site: baseSite(),
        workDir,
        env,
        logger,
        signal: ac.signal,
      }),
    ).rejects.toThrow('nuclei aborted: server shutting down')
  })

  it('throws EngineError with no target URLs, before spawning the binary', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'work')
    await expect(
      runNuclei({
        scanId: 'scan-3',
        engine: 'nuclei',
        // every configured path excluded → nothing left to scan
        site: baseSite({ nucleiPaths: '/only', excludePaths: '/only' }),
        workDir,
        env,
        logger,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/no target URLs/)
    expect(existsSync(join(workDir, 'targets.txt'))).toBe(false)
  })
})

// Records argv next to the output file so a test can assert on the exact
// flags the engine passed, then behaves like FAKE_SUCCESS.
const FAKE_RECORD_ARGS = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
fs.writeFileSync(path.join(path.dirname(outFile), 'argv.json'), JSON.stringify(args))
fs.writeFileSync(outFile, '')
console.log(JSON.stringify({ requests: '10', errors: '0' }))
process.exit(0)
`

describe('runNuclei active injection checks (allowMutatingRequests)', () => {
  let tmp: string
  const logger = pino({ level: 'silent' })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-nuclei-dast-'))
  })

  async function run(site: SiteWithHeaders) {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_RECORD_ARGS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
      SAKUDA_NUCLEI_TEMPLATES: '/tpl/http',
      SAKUDA_NUCLEI_DAST_TEMPLATES: '/tpl/dast',
    })
    const workDir = join(tmp, 'work')
    const out = await runNuclei({
      scanId: 'scan-dast',
      engine: 'nuclei',
      site,
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })
    // as: argv.json is written by the fake binary above as a JSON string[]
    const argv = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8')) as string[]
    return { out, argv }
  }

  it('passes neither -dast nor the DAST template dir when the site is not opted in', async () => {
    const { out, argv } = await run(baseSite({ nucleiPaths: '/search?q=' }))
    expect(argv).not.toContain('-dast')
    expect(argv).not.toContain('/tpl/dast')
    expect(out.meta.activeScan).toBe(false)
    expect(out.meta.dastTemplatesDir).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  it('seeds empty query values in the targets file only when opted in', async () => {
    const on = await run(baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=' }))
    expect(readFileSync(join(tmp, 'work', 'targets.txt'), 'utf8')).toContain('/search?q=1')

    const off = await run(baseSite({ nucleiPaths: '/search?q=' }))
    expect(readFileSync(join(tmp, 'work', 'targets.txt'), 'utf8')).toContain('/search?q=\n')
    expect(readFileSync(join(tmp, 'work', 'targets.txt'), 'utf8')).not.toContain('/search?q=1')
    void on
    void off
  })

  it('drops hash-route lines from the targets file (fragments never reach the server)', async () => {
    await run(baseSite({ nucleiPaths: '/plain\n/#/search?q=\n/#/track?id=' }))
    const targets = readFileSync(join(tmp, 'work', 'targets.txt'), 'utf8')
    expect(targets).toBe('http://localhost:3001/plain\n')
    expect(targets).not.toContain('#')
  })

  it('passes -dast and the DAST template dir when the site is opted in', async () => {
    const { out, argv } = await run(
      baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=\n/plain' }),
    )
    expect(argv).toContain('-dast')
    expect(argv.slice(argv.indexOf('-t'), argv.indexOf('-t') + 4)).toEqual([
      '-t',
      '/tpl/http',
      '-t',
      '/tpl/dast',
    ])
    expect(out.meta.activeScan).toBe(true)
    expect(out.meta.dastTemplatesDir).toBe('/tpl/dast')
    expect(out.meta.parameterizedUrlCount).toBe(1)
    expect(out.warnings).toEqual([])
  })

  it('opts a risk group back in: -exclude-tags drops it and -tags gains its extra tags', async () => {
    const { argv } = await run(
      baseSite({ allowMutatingRequests: true, nucleiEnabledRiskTags: ['fuzz'] }),
    )
    const exclude = argv[argv.indexOf('-exclude-tags') + 1]
    const tags = argv[argv.indexOf('-tags') + 1]
    expect(exclude).toBe('dos,intrusive')
    expect(tags).toContain('cmdi')
    expect(tags).toContain('rce')
  })

  it('ignores selected risk tags while the opt-in is off (exclusion stays full)', async () => {
    const { argv } = await run(baseSite({ nucleiEnabledRiskTags: ['fuzz', 'dos'] }))
    expect(argv[argv.indexOf('-exclude-tags') + 1]).toBe('dos,fuzz,intrusive')
    expect(argv).not.toContain('cmdi')
  })

  it('warns when opted in but no saved target carries query parameters', async () => {
    const { out, argv } = await run(baseSite({ allowMutatingRequests: true }))
    expect(argv).toContain('-dast')
    expect(out.meta.parameterizedUrlCount).toBe(0)
    expect(out.warnings).toEqual([expect.stringMatching(/no saved target has query parameters/)])
  })

  it('stays passive when opted in but ownership of a non-local host is unconfirmed', async () => {
    const { out, argv } = await run(
      baseSite({
        frontBaseUrl: 'https://staging.example.com',
        requiresConfirmation: true,
        nonLocalConfirmed: false,
        allowMutatingRequests: true,
        nucleiEnabledRiskTags: [],
      }),
    )
    expect(argv).not.toContain('-dast')
    expect(out.meta.activeScan).toBe(false)
  })
})
