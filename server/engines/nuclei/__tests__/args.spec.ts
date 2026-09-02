import { describe, expect, it } from 'vitest'
import { buildNucleiArgs, NUCLEI_BASE_TAGS, nucleiTagsFor } from '../args'

describe('nucleiTagsFor', () => {
  it('returns the base tags when unauthenticated', () => {
    expect(nucleiTagsFor(false)).toEqual(NUCLEI_BASE_TAGS)
  })

  it('appends auth-bypass when authenticated', () => {
    expect(nucleiTagsFor(true)).toEqual([...NUCLEI_BASE_TAGS, 'auth-bypass'])
  })
})

describe('buildNucleiArgs', () => {
  it('builds the exact argument array', () => {
    expect(
      buildNucleiArgs({
        targetsFile: 't.txt',
        templatesDir: '/tpl',
        outputFile: 'o.jsonl',
        rateLimit: 50,
        concurrency: 25,
        tags: ['xss', 'sqli'],
        headers: [{ name: 'Cookie', value: 'a=b' }],
      }),
    ).toEqual([
      '-l',
      't.txt',
      '-t',
      '/tpl',
      '-tags',
      'xss,sqli',
      '-severity',
      'critical,high,medium',
      '-exclude-tags',
      'dos,fuzz,intrusive',
      '-rate-limit',
      '50',
      '-c',
      '25',
      '-jsonl',
      '-o',
      'o.jsonl',
      '-stats-json',
      '-si',
      '5',
      '-duc',
      '-nc',
      '-omit-raw',
      '-H',
      'Cookie: a=b',
    ])
  })

  it('always includes -omit-raw so request/response pairs (which may contain injected auth headers) are never written to disk', () => {
    expect(
      buildNucleiArgs({
        targetsFile: 't.txt',
        templatesDir: '/tpl',
        outputFile: 'o.jsonl',
        rateLimit: 50,
        concurrency: 25,
        tags: ['xss'],
        headers: [],
        browserStorage: [],
      }),
    ).toContain('-omit-raw')
  })
})

describe('buildNucleiArgs with active checks (dastTemplatesDir)', () => {
  const base = {
    targetsFile: 't.txt',
    templatesDir: '/tpl/http',
    outputFile: 'o.jsonl',
    rateLimit: 50,
    concurrency: 25,
    tags: ['sqli'],
    headers: [],
  }

  it('adds the DAST template tree as a second -t and the -dast flag', () => {
    const args = buildNucleiArgs({ ...base, dastTemplatesDir: '/tpl/dast' })
    expect(args.slice(0, 6)).toEqual(['-l', 't.txt', '-t', '/tpl/http', '-t', '/tpl/dast'])
    expect(args).toContain('-dast')
    // the risk exclusions stay in place even in active mode
    expect(args.slice(args.indexOf('-exclude-tags'), args.indexOf('-exclude-tags') + 3)).toEqual([
      '-exclude-tags',
      'dos,fuzz,intrusive',
      '-dast',
    ])
  })

  it('is byte-for-byte the passive argument list when dastTemplatesDir is absent', () => {
    expect(buildNucleiArgs({ ...base, dastTemplatesDir: undefined })).toEqual(buildNucleiArgs(base))
    expect(buildNucleiArgs(base)).not.toContain('-dast')
    expect(buildNucleiArgs(base).filter((a) => a === '-t')).toHaveLength(1)
  })
})
