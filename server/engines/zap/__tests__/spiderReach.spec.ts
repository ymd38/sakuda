import { describe, expect, it } from 'vitest'
import { isSeedAccessFailure, parseJobAccessFailures, seedPathReached } from '../spiderReach'

describe('parseJobAccessFailures', () => {
  it('extracts job, url and reason from each failure line, ignoring the rest', () => {
    const stderr = [
      'Picked up JAVA_TOOL_OPTIONS: -Xmx1024m',
      'Job spider failed to access URL http://host.docker.internal:3000/talent/ : Network is unreachable',
      'java.net.SocketException: Network is unreachable',
      '  at java.base/sun.nio.ch.Net.connect0(Native Method)',
      'Job spiderAjax failed to access URL http://host.docker.internal:3000/other : Connection refused ',
      '',
    ].join('\n')
    expect(parseJobAccessFailures(stderr)).toEqual([
      {
        job: 'spider',
        url: 'http://host.docker.internal:3000/talent/',
        reason: 'Network is unreachable',
      },
      {
        job: 'spiderAjax',
        url: 'http://host.docker.internal:3000/other',
        reason: 'Connection refused',
      },
    ])
  })

  it('recognizes the unknown-host variants (DNS failure, direct or via the proxy chain)', () => {
    const stderr = [
      'Job spider failed to access URL http://target.example:3000/talent check that it is valid : target.example',
      'Job spider failed to access URL http://target.example:3000/talent your proxy chain may be wrong : proxy.example',
    ].join('\n')
    expect(parseJobAccessFailures(stderr)).toEqual([
      { job: 'spider', url: 'http://target.example:3000/talent', reason: 'target.example' },
      { job: 'spider', url: 'http://target.example:3000/talent', reason: 'proxy.example' },
    ])
  })

  it('returns an empty list for an empty or unrelated log', () => {
    expect(parseJobAccessFailures('')).toEqual([])
    expect(parseJobAccessFailures('Job spider found 3 URLs\n')).toEqual([])
  })
})

describe('isSeedAccessFailure', () => {
  const seed = 'http://host.docker.internal:3000/talent'

  it('matches the spider failing on the seed, trailing slash or not', () => {
    const f = { job: 'spider', url: 'http://host.docker.internal:3000/talent/', reason: 'x' }
    expect(isSeedAccessFailure(f, seed)).toBe(true)
    expect(isSeedAccessFailure({ ...f, url: seed }, seed)).toBe(true)
  })

  it('ignores other jobs, other pages and unparsable URLs', () => {
    expect(isSeedAccessFailure({ job: 'spiderAjax', url: seed, reason: 'x' }, seed)).toBe(false)
    expect(
      isSeedAccessFailure(
        { job: 'spider', url: 'http://host.docker.internal:3000/talent/deep', reason: 'x' },
        seed,
      ),
    ).toBe(false)
    expect(
      isSeedAccessFailure(
        { job: 'spider', url: 'http://localhost:3000/talent', reason: 'x' },
        seed,
      ),
    ).toBe(false)
    expect(isSeedAccessFailure({ job: 'spider', url: '::nope::', reason: 'x' }, seed)).toBe(false)
  })
})

describe('seedPathReached', () => {
  const crawled = [
    'http://localhost:3000/',
    'http://localhost:3000/dash/',
    'http://localhost:3000/search?q=a',
    'http://localhost:3000/main.js',
  ]

  it('compares path + query, ignoring a trailing slash', () => {
    expect(seedPathReached('/dash', crawled)).toBe(true)
    expect(seedPathReached('/dash/', crawled)).toBe(true)
    expect(seedPathReached('/search?q=a', crawled)).toBe(true)
    expect(seedPathReached('/search?q=b', crawled)).toBe(false)
    expect(seedPathReached('/profile', crawled)).toBe(false)
    expect(seedPathReached('/dash', [])).toBe(false)
  })

  it('cannot judge a root seed or a hash route (the fragment never reaches the server)', () => {
    expect(seedPathReached('/', crawled)).toBeNull()
    expect(seedPathReached('/#/dashboard', crawled)).toBeNull()
    expect(seedPathReached('/#/', [])).toBeNull()
  })
})
