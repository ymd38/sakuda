import { describe, expect, it } from 'vitest'
import {
  isUnverifiedTimeBasedCmdi,
  normalizeNucleiLines,
  parseNucleiJsonl,
  parseNucleiStats,
  parseSkippedHosts,
} from '../normalize'

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
    // raw.request/raw.response are never persisted, even when nuclei's JSONL
    // line includes them (e.g. -omit-raw is added to argv, but this is the
    // last line of defense against the site's auth headers reaching disk).
    expect(f.raw).not.toHaveProperty('request')
    expect(f.raw).not.toHaveProperty('response')
  })

  it('falls back to host when matched-at is absent', () => {
    const line = JSON.stringify({
      'template-id': 't1',
      info: { name: 'n', severity: 'high' },
      host: 'host.docker.internal:3001',
    })
    const { lines } = parseNucleiJsonl(line)
    const { findings } = normalizeNucleiLines(lines, unalias)
    expect(findings[0]!.url).toBe('localhost:3001')
  })

  it('is an empty url when neither matched-at nor host is present', () => {
    const line = JSON.stringify({ 'template-id': 't1', info: { name: 'n', severity: 'high' } })
    const { lines } = parseNucleiJsonl(line)
    const { findings } = normalizeNucleiLines(lines, unalias)
    expect(findings[0]!.url).toBe('')
  })

  it('never stores raw.request/raw.response even for a long request/response pair', () => {
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
    expect(findings[0]!.raw).not.toHaveProperty('request')
    expect(findings[0]!.raw).not.toHaveProperty('response')
  })

  const cmdiTimeBased = {
    'template-id': 'windows-command-injection',
    info: {
      name: 'Windows Command Injection - Generic Detection',
      severity: 'high',
      tags: ['cmdi', 'dast', 'rce', 'fuzz'],
    },
    'matched-at': 'http://host.docker.internal:4001/api/Products/3?d&&whoami',
    'matcher-name': 'time-based',
  }

  it('demotes a timing-only command-injection match to low (counted, not a confirmed finding)', () => {
    const { lines } = parseNucleiJsonl(JSON.stringify(cmdiTimeBased))
    const { findings, counts } = normalizeNucleiLines(lines, (u) => u)
    // high template severity, but timing-only with no extracted output → low.
    expect(counts.high).toBe(0)
    expect(counts.low).toBe(1)
    // below the reported floor, so not emitted as a detailed finding — but the
    // low count keeps the timing signal visible rather than silently dropping it.
    expect(findings).toHaveLength(0)
  })

  it('keeps a command-injection match that extracted command output at its severity', () => {
    const line = JSON.stringify({
      ...cmdiTimeBased,
      'matcher-name': 'unix',
      'extracted-results': ['uid=0(root) gid=0(root)'],
    })
    const { lines } = parseNucleiJsonl(line)
    const { findings, counts } = normalizeNucleiLines(lines, (u) => u)
    expect(counts.high).toBe(1)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('high')
  })

  it('does not demote a time-based match of a non-cmdi template (e.g. sqli)', () => {
    const line = JSON.stringify({
      'template-id': 'time-based-sqli',
      info: {
        name: 'Time-Based Blind SQL Injection',
        severity: 'critical',
        tags: ['sqli', 'dast'],
      },
      'matched-at': 'http://h/rest/products/search?q=1',
      'matcher-name': 'time-based',
    })
    const { lines } = parseNucleiJsonl(line)
    const { counts } = normalizeNucleiLines(lines, (u) => u)
    expect(counts.critical).toBe(1)
    expect(counts.low).toBe(0)
  })
})

describe('isUnverifiedTimeBasedCmdi', () => {
  const base = {
    'template-id': 'unix-command-injection',
    info: { name: 'n', severity: 'high', tags: ['cmdi', 'dast'] },
    'matcher-name': 'time-based',
  }
  it('is true for a cmdi template matched time-based with no extracted output', () => {
    expect(isUnverifiedTimeBasedCmdi(parseNucleiJsonl(JSON.stringify(base)).lines[0]!)).toBe(true)
  })
  it('is false when command output was extracted (corroborated)', () => {
    const l = parseNucleiJsonl(JSON.stringify({ ...base, 'extracted-results': ['uid=0'] }))
      .lines[0]!
    expect(isUnverifiedTimeBasedCmdi(l)).toBe(false)
  })
  it('is false for a non-time-based matcher', () => {
    const l = parseNucleiJsonl(JSON.stringify({ ...base, 'matcher-name': 'word' })).lines[0]!
    expect(isUnverifiedTimeBasedCmdi(l)).toBe(false)
  })
  it('is false for a non-cmdi template', () => {
    const l = parseNucleiJsonl(
      JSON.stringify({ ...base, info: { name: 'n', severity: 'high', tags: ['sqli'] } }),
    ).lines[0]!
    expect(isUnverifiedTimeBasedCmdi(l)).toBe(false)
  })
})

describe('parseNucleiStats percent (#82)', () => {
  it('keeps the percent field of the last stats line', () => {
    const log = [
      JSON.stringify({ requests: '100', errors: '0', percent: '50' }),
      '[INF] something',
      JSON.stringify({ requests: '70268', errors: '1557', percent: '8', total: '868770' }),
    ].join('\n')
    expect(parseNucleiStats(log)).toMatchObject({ percent: '8', total: '868770' })
  })
})

describe('parseSkippedHosts (#82)', () => {
  const stderr = [
    '[INF] Executing 5022 signed templates from projectdiscovery/nuclei-templates',
    '[INF] Targets loaded for current scan: 70',
    '[INF] Skipped host.docker.internal:4001 from target list as found unresponsive 33 times',
    '[INF] Skipped host.docker.internal:4001 from target list as found unresponsive 49 times',
    '[INF] Skipped api.example.test:8443 from target list as found unresponsive 30 times',
    '[INF] Scan completed in 16m. 0 matches found.',
  ].join('\n')

  it('returns one entry per skipped host with its highest error count', () => {
    expect(parseSkippedHosts(stderr)).toEqual([
      { host: 'host.docker.internal:4001', errors: 49 },
      { host: 'api.example.test:8443', errors: 30 },
    ])
  })

  it('matches the message behind a timestamp or logger prefix', () => {
    expect(
      parseSkippedHosts(
        '[2026-09-08 14:50:01] [INF] Skipped host.docker.internal:4001 from target list as found unresponsive 30 times\n',
      ),
    ).toEqual([{ host: 'host.docker.internal:4001', errors: 30 }])
  })

  it('is empty when nuclei skipped nothing', () => {
    expect(parseSkippedHosts('[INF] Scan completed in 1m. 3 matches found.\n')).toEqual([])
    expect(parseSkippedHosts('')).toEqual([])
  })
})
