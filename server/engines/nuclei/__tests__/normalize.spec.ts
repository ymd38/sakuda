import { describe, expect, it } from 'vitest'
import { normalizeNucleiLines, parseNucleiJsonl, parseNucleiStats } from '../normalize'

const highLine = JSON.stringify({
  'template-id': 'ftp-anon-login',
  info: { name: 'FTP Anonymous Login', severity: 'high' },
  type: 'network',
  host: 'host.docker.internal:3001',
  'matched-at': 'http://host.docker.internal:3001/ftp?x=1',
  'matcher-name': 'anon',
  'extracted-results': ['a'],
  request: 'GET /ftp HTTP/1.1\r\nHost: host.docker.internal:3001\r\n',
  response: 'HTTP/1.1 200 OK\r\n',
  timestamp: '2026-01-01T00:00:00Z',
})

const infoLine = JSON.stringify({
  'template-id': 'tech-detect',
  info: { name: 'Tech Detect', severity: 'info' },
  host: 'host.docker.internal:3001',
})

const garbageLine = '{not json'

describe('parseNucleiJsonl', () => {
  it('parses valid lines and counts invalid ones', () => {
    const { lines, invalidLines } = parseNucleiJsonl(
      [highLine, infoLine, garbageLine, ''].join('\n'),
    )
    expect(lines).toHaveLength(2)
    expect(invalidLines).toBe(1)
  })
})

describe('parseNucleiStats', () => {
  it('returns the last stats object in the log text', () => {
    expect(
      parseNucleiStats(
        'INF x\n{"requests":"10","errors":"1"}\n{"requests":"62854","errors":"1445","rps":"55"}\n',
      ),
    ).toEqual({ requests: '62854', errors: '1445', rps: '55' })
  })

  it('returns null when no stats line is present', () => {
    expect(parseNucleiStats('INF just logs\nmore logs\n')).toBeNull()
  })
})

describe('normalizeNucleiLines', () => {
  const unalias = (u: string) => u.replace('host.docker.internal', 'localhost')

  it('normalizes lines into findings and counts, un-aliasing the url', () => {
    const { lines } = parseNucleiJsonl([highLine, infoLine].join('\n'))
    const { findings, counts } = normalizeNucleiLines(lines, unalias)

    expect(counts.high).toBe(1)
    expect(counts.info).toBe(1)
    expect(findings).toHaveLength(1)

    const f = findings[0]!
    expect(f.url).toBe('http://localhost:3001/ftp?x=1')
    expect(f.method).toBe('GET')
    expect(f.evidence).toBe('a')
    expect(f.severity).toBe('high')
    expect(f.ruleId).toBe('ftp-anon-login')
    expect(f.raw.request).toBe('GET /ftp HTTP/1.1\r\nHost: host.docker.internal:3001\r\n')
  })

  it('truncates raw.request/response to 4000 chars', () => {
    const long = 'x'.repeat(5000)
    const line = JSON.stringify({
      'template-id': 't1',
      info: { name: 'n', severity: 'high' },
      'matched-at': 'http://h/p',
      request: long,
      response: long,
    })
    const { lines } = parseNucleiJsonl(line)
    const { findings } = normalizeNucleiLines(lines, (u) => u)
    expect((findings[0]!.raw.request as string).length).toBe(4000 + '…[truncated]'.length)
    expect((findings[0]!.raw.request as string).startsWith('x'.repeat(4000))).toBe(true)
  })
})
