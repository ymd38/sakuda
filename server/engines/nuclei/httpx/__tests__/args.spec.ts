import { describe, expect, it } from 'vitest'
import { buildHttpxArgs, redactHttpxArgs } from '../args'

describe('buildHttpxArgs', () => {
  const args = buildHttpxArgs({
    targetsFile: 't.txt',
    threads: 25,
    rateLimit: 50,
    headers: [{ name: 'Cookie', value: 'a=b' }],
  })

  it('builds the exact argument array', () => {
    expect(args).toEqual([
      '-l',
      't.txt',
      '-json',
      '-silent',
      '-nc',
      '-nfs',
      '-probe',
      '-duc',
      '-retries',
      '0',
      '-timeout',
      '10',
      '-threads',
      '25',
      '-rl',
      '50',
      '-H',
      'Cookie: a=b',
    ])
  })

  it('never follows redirects, never falls back to the other scheme, never probes both', () => {
    expect(args).not.toContain('-fr')
    expect(args).not.toContain('-follow-redirects')
    expect(args).not.toContain('-nf')
    expect(args).toContain('-nfs')
  })

  it('reports failed targets as lines rather than omitting them', () => {
    expect(args).toContain('-probe')
  })
})

describe('redactHttpxArgs', () => {
  it('masks every -H value, keeps the header name, and leaves the rest untouched', () => {
    const args = buildHttpxArgs({
      targetsFile: 't.txt',
      threads: 1,
      rateLimit: 1,
      headers: [
        { name: 'Authorization', value: 'Bearer secret-token' },
        { name: 'Cookie', value: 'session=abc; other=def' },
      ],
    })
    const redacted = redactHttpxArgs(args)
    expect(redacted).toEqual([
      ...args.slice(0, args.indexOf('-H')),
      '-H',
      'Authorization: ***',
      '-H',
      'Cookie: ***',
    ])
    expect(redacted.join(' ')).not.toContain('secret-token')
    expect(redacted.join(' ')).not.toContain('session=abc')
    // pure
    expect(args).toContain('Authorization: Bearer secret-token')
  })

  it('is a no-op without headers', () => {
    const args = ['-l', 't.txt', '-json']
    expect(redactHttpxArgs(args)).toEqual(args)
  })
})
