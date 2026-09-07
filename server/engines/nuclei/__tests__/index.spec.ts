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
    ).rejects.toThrow(/no GET target URLs/)
    expect(existsSync(join(workDir, 'targets.txt'))).toBe(false)
  })

  it('replays only GET saved lines, skips non-GET into meta.skippedMethods, and never writes a non-GET target', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'skip')
    const out = await runNuclei({
      scanId: 'scan-skip',
      engine: 'nuclei',
      // the two `POST /api/x` lines collapse (dedupe is method+base+url)
      site: baseSite({ nucleiPaths: '/get-one\nPOST /api/x\nPOST /api/x\nDELETE /y\nHEAD /z' }),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })
    expect(out.meta.skippedMethods).toEqual({ POST: 1, DELETE: 1, HEAD: 1 })
    expect(out.meta.urlCount).toBe(1)
    const targets = readFileSync(join(workDir, 'targets.txt'), 'utf8')
    expect(targets).toContain('/get-one')
    expect(targets).not.toContain('/api/x')
    expect(targets).not.toContain('/y')
    expect(targets).not.toContain('/z')
  })

  it('writes one target when a front line and an api: line resolve to the same URL', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'same-url')
    const out = await runNuclei({
      scanId: 'scan-same-url',
      engine: 'nuclei',
      // apiBaseUrl is the front base plus `/api`, so `/api/x` and `api:/x`
      // are the same request; the expansion keeps both (identity is
      // method+base+url) and nuclei must not replay the URL twice
      site: baseSite({
        apiBaseUrl: 'http://localhost:3001/api',
        nucleiPaths: '/api/x\napi:/x\nPOST /api/y\nPOST api:/y',
      }),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })
    expect(readFileSync(join(workDir, 'targets.txt'), 'utf8')).toBe('http://localhost:3001/api/x\n')
    expect(out.meta.urlCount).toBe(1)
    expect(out.meta.skippedMethods).toEqual({ POST: 1 })
  })

  it('under active checks, fuzzes a non-GET-with-query via a generated OpenAPI phase, skips a queryless one, and deletes the secret docs', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    const workDir = join(tmp, 'active')
    const out = await runNuclei({
      scanId: 'scan-openapi',
      engine: 'nuclei',
      site: baseSite({
        allowMutatingRequests: true,
        nucleiPaths: '/get?q=\nPOST /api/x?p=\nPOST /bodyless',
      }),
      workDir,
      env,
      logger,
      signal: new AbortController().signal,
    })
    // POST /api/x?p= has a query surface → one generated doc, run once.
    expect(out.meta.openapiDocCount).toBe(1)
    expect(out.meta.openapiDocsRun).toBe(1)
    // POST /bodyless has no query and gets no invented body → skipped-with-reason.
    expect(out.meta.skippedNoFuzzSeed).toEqual({ POST: 1 })
    // active run: nothing is in the "not attempted at all" bucket.
    expect(out.meta.skippedMethods).toBeUndefined()
    // every phase produced a finding via the fake binary: signature + GET DAST + OpenAPI
    expect(out.counts.high).toBe(3)
    // the GET phase's transient targets file seeded the empty query
    expect(readFileSync(join(workDir, 'targets.txt'), 'utf8')).toContain('/get?q=1')
    // the generated OpenAPI doc and its outputs are removed after the run
    expect(existsSync(join(workDir, 'openapi-0.json'))).toBe(false)
    expect(existsSync(join(workDir, 'openapi-findings-0.jsonl'))).toBe(false)
  })

  it('under active checks with only a queryless non-GET target, there is nothing to scan', async () => {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', FAKE_SUCCESS)
    const env: Env = parseEnv({
      SAKUDA_ENCRYPTION_KEY: key,
      SAKUDA_NUCLEI_BIN: fakeBin,
      SAKUDA_DATA_DIR: tmp,
    })
    await expect(
      runNuclei({
        scanId: 'scan-empty',
        engine: 'nuclei',
        site: baseSite({ allowMutatingRequests: true, nucleiPaths: 'POST /bodyless' }),
        workDir: join(tmp, 'nothing'),
        env,
        logger,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/nothing to scan/)
  })
})

// Records argv next to the output file — one file per phase, named after
// the phase's output (`argv-findings.jsonl.json`, `argv-dast-findings.jsonl.json`)
// so a test can assert on the exact flags of each nuclei run — then behaves
// like FAKE_SUCCESS without findings.
const FAKE_RECORD_ARGS = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
fs.writeFileSync(path.join(path.dirname(outFile), 'argv-' + path.basename(outFile) + '.json'), JSON.stringify(args))
fs.writeFileSync(outFile, '')
console.log(JSON.stringify({ requests: '10', errors: '0' }))
process.exit(0)
`

// Like FAKE_SUCCESS (one "high" finding per run) but exits 2 with no output
// when invoked as the GET DAST phase (`-dast` without `-im`).
const FAKE_DAST_PHASE_FAILS = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
if (args.includes('-dast') && !args.includes('-im')) process.exit(2)
const finding = {
  'template-id': 'fake-high',
  info: { name: 'Fake High', severity: 'high' },
  host: 'localhost:3001',
  'matched-at': 'http://localhost:3001/a',
}
fs.writeFileSync(outFile, JSON.stringify(finding) + '\\n')
console.log(JSON.stringify({ requests: '10', errors: '0' }))
process.exit(0)
`

// The GET DAST phase exits 2 with no output; every other run completes
// cleanly with no findings (an "empty" phase, not a failed one).
const FAKE_DAST_FAILS_OTHERS_EMPTY = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
if (args.includes('-dast') && !args.includes('-im')) process.exit(2)
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

  async function run(site: SiteWithHeaders, fake = FAKE_RECORD_ARGS) {
    const fakeBin = writeFakeBin(tmp, 'fake-nuclei.js', fake)
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
    // as: the argv files are written by the fake binary above as JSON string[]
    const argvOf = (output: string): string[] | null => {
      const p = join(workDir, `argv-${output}.json`)
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as string[]) : null
    }
    // signature phase = `findings.jsonl`; GET DAST phase = `dast-findings.jsonl`
    return { out, argv: argvOf('findings.jsonl')!, dastArgv: argvOf('dast-findings.jsonl') }
  }

  it('runs the signature phase only, never -dast, when the site is not opted in', async () => {
    const { out, argv, dastArgv } = await run(baseSite({ nucleiPaths: '/search?q=' }))
    expect(argv).not.toContain('-dast')
    expect(argv).not.toContain('/tpl/dast')
    expect(dastArgv).toBeNull()
    expect(out.meta.activeScan).toBe(false)
    expect(out.meta.dastTemplatesDir).toBeUndefined()
    expect(out.meta.signaturePhase).toBe('empty')
    expect(out.meta.dastPhase).toBe('skipped')
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

  it('under active checks runs two GET phases: signature (http tree, no -dast) then DAST (dast tree, -dast)', async () => {
    const { out, argv, dastArgv } = await run(
      baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=\n/plain' }),
    )
    // signature phase: the http tree only, and never -dast (it would drop every signature template)
    expect(argv).not.toContain('-dast')
    expect(argv.filter((a) => a === '-t')).toHaveLength(1)
    expect(argv[argv.indexOf('-t') + 1]).toBe('/tpl/http')
    // DAST phase: the dast tree only, with -dast, against the same targets file
    expect(dastArgv).not.toBeNull()
    expect(dastArgv).toContain('-dast')
    expect(dastArgv!.filter((a) => a === '-t')).toHaveLength(1)
    expect(dastArgv![dastArgv!.indexOf('-t') + 1]).toBe('/tpl/dast')
    expect(dastArgv![dastArgv!.indexOf('-l') + 1]).toBe(argv[argv.indexOf('-l') + 1])
    expect(out.meta.activeScan).toBe(true)
    expect(out.meta.dastTemplatesDir).toBe('/tpl/dast')
    expect(out.meta.signaturePhase).toBe('empty')
    expect(out.meta.dastPhase).toBe('empty')
    expect(out.meta.parameterizedUrlCount).toBe(1)
    expect(out.warnings).toEqual([])
  })

  it('opts a risk group back in: both GET phases drop it from -exclude-tags and gain its extra -tags', async () => {
    const { argv, dastArgv } = await run(
      baseSite({ allowMutatingRequests: true, nucleiEnabledRiskTags: ['fuzz'] }),
    )
    for (const a of [argv, dastArgv!]) {
      expect(a[a.indexOf('-exclude-tags') + 1]).toBe('dos,intrusive')
      expect(a[a.indexOf('-tags') + 1]).toContain('cmdi')
      expect(a[a.indexOf('-tags') + 1]).toContain('rce')
    }
    expect(dastArgv![dastArgv!.indexOf('-tags') + 1]).toBe(argv[argv.indexOf('-tags') + 1])
  })

  it('merges the findings of both GET phases', async () => {
    const { out } = await run(
      baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=' }),
      FAKE_SUCCESS,
    )
    // one fake "high" per nuclei run: signature + DAST
    expect(out.counts.high).toBe(2)
    expect(out.findings).toHaveLength(2)
    expect(out.meta.signaturePhase).toBe('ok')
    expect(out.meta.dastPhase).toBe('ok')
    expect(out.exitCode).toBe(0)
  })

  it('keeps the signature findings and warns when the DAST phase fails', async () => {
    const { out } = await run(
      baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=' }),
      FAKE_DAST_PHASE_FAILS,
    )
    expect(out.counts.high).toBe(1)
    expect(out.meta.signaturePhase).toBe('ok')
    expect(out.meta.dastPhase).toBe('failed')
    expect(out.exitCode).toBe(1)
    expect(out.warnings).toEqual([expect.stringMatching(/nuclei DAST phase failed/)])
  })

  it('does not report "every phase failed" when the signature phase completed empty and only the DAST phase failed', async () => {
    const { out } = await run(
      baseSite({ allowMutatingRequests: true, nucleiPaths: '/search?q=' }),
      FAKE_DAST_FAILS_OTHERS_EMPTY,
    )
    expect(out.counts.high).toBe(0)
    expect(out.meta.signaturePhase).toBe('empty')
    expect(out.meta.dastPhase).toBe('failed')
    expect(out.exitCode).toBe(1)
    expect(out.warnings).toEqual([expect.stringMatching(/nuclei DAST phase failed/)])
  })

  it('ignores selected risk tags while the opt-in is off (exclusion stays full)', async () => {
    const { argv } = await run(baseSite({ nucleiEnabledRiskTags: ['fuzz', 'dos'] }))
    expect(argv[argv.indexOf('-exclude-tags') + 1]).toBe('dos,fuzz,intrusive')
    expect(argv).not.toContain('cmdi')
  })

  it('warns when opted in but no saved target carries query parameters', async () => {
    const { out, dastArgv } = await run(baseSite({ allowMutatingRequests: true }))
    expect(dastArgv).toContain('-dast')
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
    expect(out.meta.dastPhase).toBe('skipped')
  })
})
