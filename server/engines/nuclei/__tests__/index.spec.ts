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
    excludePaths: '',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: false,
    headerNames: [],
    requiresConfirmation: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    headers: [],
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
        site: baseSite({ nucleiPaths: '' }),
        workDir,
        env,
        logger,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/no target URLs/)
    expect(existsSync(join(workDir, 'targets.txt'))).toBe(false)
  })
})
