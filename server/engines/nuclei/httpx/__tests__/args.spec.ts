import { describe, expect, it } from 'vitest'
import { buildHttpxArgs } from '../args'

describe('buildHttpxArgs', () => {
  const args = buildHttpxArgs({
    targetsFile: 't.txt',
    threads: 25,
    rateLimit: 50,
    headersConfigFile: '/w/headers.json',
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
      '-config',
      '/w/headers.json',
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

describe('headers never on argv (#95)', () => {
  it('omits -config entirely when the site has no headers', () => {
    const args = buildHttpxArgs({
      targetsFile: 't.txt',
      threads: 1,
      rateLimit: 1,
      headersConfigFile: null,
    })
    expect(args).not.toContain('-config')
    expect(args).not.toContain('-H')
  })
})
