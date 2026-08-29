import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { EnvError, parseEnv } from '../env'
const key = randomBytes(32).toString('base64')
describe('parseEnv', () => {
  it('fails fast without SAKUDA_ENCRYPTION_KEY', () => {
    expect(() => parseEnv({})).toThrow(EnvError)
    expect(() => parseEnv({})).toThrow(/SAKUDA_ENCRYPTION_KEY/)
  })
  it('rejects a key that is not 32 bytes', () => {
    expect(() => parseEnv({ SAKUDA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /32 bytes/,
    )
  })
  it('applies defaults and derives paths', () => {
    const env = parseEnv({ SAKUDA_ENCRYPTION_KEY: key, SAKUDA_DATA_DIR: '/tmp/x' })
    expect(env.dbFile).toBe('/tmp/x/sakuda.db')
    expect(env.scansDir).toBe('/tmp/x/scans')
    expect(env.nuclei.maxMinutes).toBe(60)
    expect(env.zap.cmd).toBe('zap.sh')
    expect(env.jobRunner).toBe(true)
  })
  it('zap alias falls back to the general alias', () => {
    expect(
      parseEnv({ SAKUDA_ENCRYPTION_KEY: key, SAKUDA_LOCALHOST_ALIAS: 'host.docker.internal' }).zap
        .localhostAlias,
    ).toBe('host.docker.internal')
    const env2 = parseEnv({ SAKUDA_ENCRYPTION_KEY: key, SAKUDA_ZAP_LOCALHOST_ALIAS: 'gw' })
    expect(env2.localhostAlias).toBeUndefined()
    expect(env2.zap.localhostAlias).toBe('gw')
  })
  it('rejects non-integer minutes', () => {
    expect(() =>
      parseEnv({ SAKUDA_ENCRYPTION_KEY: key, SAKUDA_NUCLEI_MAX_MINUTES: 'ten' }),
    ).toThrow(EnvError)
  })
})
