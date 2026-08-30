import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseEnv, type Env } from '../../../config/env'
import { runZap, zapPath } from '../runZap'
import { writeFakeZap } from './fakeZap'

const FIXTURE = join(__dirname, 'fixtures', 'zap-report.json')
const key = randomBytes(32).toString('base64')
const logger = pino({ level: 'silent' })

function makeEnv(overrides: Record<string, string> = {}, fakeBin: string): Env {
  return parseEnv({
    SAKUDA_ENCRYPTION_KEY: key,
    SAKUDA_ZAP_CMD: fakeBin,
    ...overrides,
  })
}

describe('zapPath', () => {
  it('joins under env.zap.workDir (posix) when set', () => {
    const env = makeEnv({ SAKUDA_ZAP_WORKDIR: '/zap/wrk' }, 'zap.sh')
    expect(zapPath(env, '/host/work', 'plan.yaml')).toBe('/zap/wrk/plan.yaml')
  })

  it('joins under the host work dir when unset', () => {
    const env = makeEnv({}, 'zap.sh')
    expect(zapPath(env, '/host/work', 'plan.yaml')).toBe(join('/host/work', 'plan.yaml'))
  })
})

describe('runZap', () => {
  let tmp: string
  let workDir: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-zap-'))
    workDir = join(tmp, 'work')
  })

  it('writes plan.yaml, writes replacer.conf mode 0600 during the run, and deletes it after', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin)
    const out = await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: 'replacer.full_list(0).enabled=true\n',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    expect(readFileSync(join(workDir, 'plan.yaml'), 'utf8')).toBe('plan: yes\n')
    // conf-mode.json is written by the fake binary while replacer.conf still exists mid-run
    expect(JSON.parse(readFileSync(join(workDir, 'conf-mode.json'), 'utf8'))).toBe(0o600)
    expect(existsSync(join(workDir, 'replacer.conf'))).toBe(false)
    expect(out.reportJsonPath).toBe(join(workDir, 'report.json'))
    expect(out.reportText).toBe(readFileSync(FIXTURE, 'utf8'))
  })

  it('uses container paths in argv when env.zap.workDir is set', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({ SAKUDA_ZAP_WORKDIR: '/zap/wrk' }, fakeBin)
    await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: 'x=1\n',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    const argv: unknown = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8'))
    expect(argv).toEqual([
      '-dir',
      '/zap/wrk/zaphome',
      '-cmd',
      '-configfile',
      '/zap/wrk/replacer.conf',
      '-autorun',
      '/zap/wrk/plan.yaml',
    ])
  })

  it('uses host paths in argv when env.zap.workDir is unset', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin)
    await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: 'x=1\n',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    const argv: unknown = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8'))
    expect(argv).toEqual([
      '-dir',
      join(workDir, 'zaphome'),
      '-cmd',
      '-configfile',
      join(workDir, 'replacer.conf'),
      '-autorun',
      join(workDir, 'plan.yaml'),
    ])
  })

  it('omits -configfile and never writes replacer.conf when replacerConf is null', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin)
    await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: null,
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    const argv: unknown = JSON.parse(readFileSync(join(workDir, 'argv.json'), 'utf8'))
    expect(argv).toEqual([
      '-dir',
      join(workDir, 'zaphome'),
      '-cmd',
      '-autorun',
      join(workDir, 'plan.yaml'),
    ])
    expect(existsSync(join(workDir, 'conf-mode.json'))).toBe(false)
  })

  it('creates a per-run zaphome dir and removes it after the run (I3: ZAP must not persist replacer values in its own $HOME/.ZAP)', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin)
    await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: 'x=1\n',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    expect(existsSync(join(workDir, 'zaphome'))).toBe(false)
  })

  it('removes zaphome when runCommand throws', async () => {
    const env = makeEnv({}, join(tmp, 'does-not-exist'))
    await expect(
      runZap({
        label: 'zap-test',
        env,
        workDir,
        planYaml: 'plan: yes\n',
        replacerConf: null,
        timeoutMs: 5000,
        signal: new AbortController().signal,
        logger,
      }),
    ).rejects.toThrow()
    expect(existsSync(join(workDir, 'zaphome'))).toBe(false)
  })

  it('passes JAVA_TOOL_OPTIONS and SAKUDA_ZAP_HOST_WORKDIR to the child', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({ SAKUDA_ZAP_MAX_HEAP: '2048m' }, fakeBin)
    await runZap({
      label: 'zap-test',
      env,
      workDir,
      planYaml: 'plan: yes\n',
      replacerConf: null,
      timeoutMs: 5000,
      signal: new AbortController().signal,
      logger,
    })

    expect(JSON.parse(readFileSync(join(workDir, 'env.json'), 'utf8'))).toEqual({
      JAVA_TOOL_OPTIONS: '-Xmx2048m',
      SAKUDA_ZAP_HOST_WORKDIR: workDir,
    })
  })

  it('removes replacer.conf when runCommand throws (I4: write happens inside the try)', async () => {
    // env.zap.cmd points at a nonexistent binary — runCommand rejects with
    // SpawnError before any output/report is produced. replacer.conf must
    // not survive that.
    const env = makeEnv({}, join(tmp, 'does-not-exist'))
    await expect(
      runZap({
        label: 'zap-test',
        env,
        workDir,
        planYaml: 'plan: yes\n',
        replacerConf: 'replacer.full_list(0).enabled=true\n',
        timeoutMs: 5000,
        signal: new AbortController().signal,
        logger,
      }),
    ).rejects.toThrow()
    expect(existsSync(join(workDir, 'replacer.conf'))).toBe(false)
  })

  it('returns reportText null when no report file was created', async () => {
    const fakeBin = writeFakeZap(tmp, FIXTURE)
    const env = makeEnv({}, fakeBin)
    process.env.FAKE_ZAP_NO_REPORT = '1'
    try {
      const out = await runZap({
        label: 'zap-test',
        env,
        workDir,
        planYaml: 'plan: yes\n',
        replacerConf: null,
        timeoutMs: 5000,
        signal: new AbortController().signal,
        logger,
      })
      expect(out.reportText).toBeNull()
      expect(out.reportJsonPath).toBe(join(workDir, 'report.json'))
    } finally {
      delete process.env.FAKE_ZAP_NO_REPORT
    }
  })
})
