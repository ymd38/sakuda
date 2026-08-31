import { describe, expect, it } from 'vitest'
import { parseSeedPathLines, resolveDiscoverySeeds } from '#shared/utils/seedPaths'

describe('parseSeedPathLines', () => {
  it('keeps one path per line, skipping blanks, comments and duplicates', () => {
    expect(parseSeedPathLines('/\n\n# top\n/#/search?q=apple\n/profile\n/\n')).toEqual({
      lines: ['/', '/#/search?q=apple', '/profile'],
      errors: [],
    })
  })

  it('reports lines that are not paths, with their line number', () => {
    const r = parseSeedPathLines('/ok\nhttp://x.example/abs\nno slash')
    expect(r.lines).toEqual(['/ok'])
    expect(r.errors).toEqual([
      'line 2: must be a path starting with "/", got "http://x.example/abs"',
      'line 3: must be a path starting with "/", got "no slash"',
    ])
  })
})

describe('resolveDiscoverySeeds', () => {
  it('falls back to zapFeSeedPath when no discovery seeds are configured', () => {
    expect(resolveDiscoverySeeds({ discoverySeedPaths: '', zapFeSeedPath: '/#/' })).toEqual(['/#/'])
    expect(
      resolveDiscoverySeeds({ discoverySeedPaths: '# only a comment', zapFeSeedPath: '/' }),
    ).toEqual(['/'])
  })

  it('uses the configured seeds when present', () => {
    expect(
      resolveDiscoverySeeds({ discoverySeedPaths: '/#/\n/#/basket', zapFeSeedPath: '/' }),
    ).toEqual(['/#/', '/#/basket'])
  })
})
