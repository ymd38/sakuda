import { describe, expect, it } from 'vitest'
import { crawlScopePrefixes, parseCrawlScopeLines } from '#shared/utils/crawlScope'
import {
  isUrlInCrawlScope,
  katanaScopeRegexes,
  resolveCrawlScope,
  zapScopeContext,
} from '../crawlScope'

describe('parseCrawlScopeLines', () => {
  it('accepts path prefixes, drops comments, trailing slashes and duplicates', () => {
    expect(parseCrawlScopeLines('# api\n/rest/\n\n/app\n/rest\n/')).toEqual({
      lines: ['/rest', '/app', '/'],
      errors: [],
    })
  })

  it('rejects anything that is not a bare path prefix', () => {
    const { lines, errors } = parseCrawlScopeLines('rest\n/search?q=a\n/#/app\nhttp://h/x\n/ok')
    expect(lines).toEqual(['/ok'])
    expect(errors).toHaveLength(4)
    expect(errors[0]).toContain('line 1')
    expect(errors[1]).toContain('line 2')
  })

  it('crawlScopePrefixes: empty or root means unrestricted', () => {
    expect(crawlScopePrefixes('')).toEqual([])
    expect(crawlScopePrefixes('/app\n/')).toEqual([])
    expect(crawlScopePrefixes('/app\n/rest')).toEqual(['/app', '/rest'])
  })
})

const site = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: null as string | null,
  crawlScopePaths: '/app\n/rest',
  discoverySeedPaths: '',
  zapFeSeedPath: '/#/',
}

describe('resolveCrawlScope / isUrlInCrawlScope', () => {
  it('is null (everything in scope) without prefixes', () => {
    expect(resolveCrawlScope({ ...site, crawlScopePaths: '' })).toBeNull()
    expect(isUrlInCrawlScope(null, 'http://anything.example/x')).toBe(true)
  })

  it('keeps URLs under a prefix, on the path boundary, query included', () => {
    const scope = resolveCrawlScope(site)
    expect(scope).toEqual({
      roots: ['http://localhost:3000/app', 'http://localhost:3000/rest'],
      api: null,
      seeds: ['http://localhost:3000/'],
    })
    for (const u of [
      'http://localhost:3000/app',
      'http://localhost:3000/app/',
      'http://localhost:3000/app/x/y',
      'http://localhost:3000/app?tab=1',
      'http://localhost:3000/rest/products/search?q=',
    ])
      expect(isUrlInCrawlScope(scope, u), u).toBe(true)
    for (const u of [
      'http://localhost:3000/application',
      'http://localhost:3000/ftp',
      'http://localhost:3000/robots.txt',
      'http://localhost:3000/#/basket', // fragment dropped → `/`, which is the seed... see below
    ])
      expect(isUrlInCrawlScope(scope, u), u).toBe(u.endsWith('/#/basket'))
    expect(isUrlInCrawlScope(scope, 'not a url')).toBe(false)
  })

  it('takes the discovery seeds only: the zap-fe seed is another engine’s start point', () => {
    const scope = resolveCrawlScope({ ...site, discoverySeedPaths: '/landing' })
    expect(scope?.seeds).toEqual(['http://localhost:3000/landing'])
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/')).toBe(false)
  })

  it('always allows the exact seed URLs (fragment dropped), not their neighbours', () => {
    const scope = resolveCrawlScope({ ...site, discoverySeedPaths: '/#/\n/landing?x=1' })
    expect(scope?.seeds).toEqual(['http://localhost:3000/', 'http://localhost:3000/landing?x=1'])
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/')).toBe(true)
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/landing?x=1')).toBe(true)
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/landing')).toBe(false)
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/landing?x=2')).toBe(false)
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/other')).toBe(false)
  })

  it('exempts the apiBaseUrl subtree — on another origin or the same one', () => {
    const other = resolveCrawlScope({ ...site, apiBaseUrl: 'http://localhost:8080' })
    expect(isUrlInCrawlScope(other, 'http://localhost:8080/v1/users')).toBe(true)
    expect(isUrlInCrawlScope(other, 'http://localhost:8080/')).toBe(true)

    const same = resolveCrawlScope({ ...site, apiBaseUrl: 'http://localhost:3000/api/' })
    expect(same?.api).toBe('http://localhost:3000/api')
    expect(isUrlInCrawlScope(same, 'http://localhost:3000/api/users')).toBe(true)
    expect(isUrlInCrawlScope(same, 'http://localhost:3000/api')).toBe(true)
    expect(isUrlInCrawlScope(same, 'http://localhost:3000/apiary')).toBe(false)
    expect(isUrlInCrawlScope(same, 'http://localhost:3000/admin')).toBe(false)
  })

  it('resolves prefixes relative to a front base that has a path', () => {
    const scope = resolveCrawlScope({ ...site, frontBaseUrl: 'http://localhost:3000/base' })
    expect(scope?.roots).toEqual([
      'http://localhost:3000/base/app',
      'http://localhost:3000/base/rest',
    ])
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/base/app/x')).toBe(true)
    expect(isUrlInCrawlScope(scope, 'http://localhost:3000/app/x')).toBe(false)
  })
})

describe('zapScopeContext', () => {
  const front = 'http://host.docker.internal:3000'

  it('unrestricted: seeds are the context URLs and each origin is included whole (as before)', () => {
    expect(zapScopeContext({ seedUrls: [front + '/#/'], front, api: null, prefixes: [] })).toEqual({
      urls: [front + '/#/'],
      includePaths: ['^http:\\/\\/host\\.docker\\.internal:3000(/.*)?$'],
    })
    expect(
      zapScopeContext({
        seedUrls: [front + '/'],
        front,
        api: 'http://host.docker.internal:8080',
        prefixes: [],
      }).includePaths,
    ).toEqual([
      '^http:\\/\\/host\\.docker\\.internal:3000(/.*)?$',
      '^http:\\/\\/host\\.docker\\.internal:8080(/.*)?$',
    ])
  })

  it('restricted: context URLs are the scope roots, seeds are included exactly (AF adds `<url>.*` per context URL)', () => {
    expect(
      zapScopeContext({
        seedUrls: [front + '/#/', front + '/#/basket'],
        front,
        api: 'http://host.docker.internal:8080',
        prefixes: ['/rest'],
      }),
    ).toEqual({
      urls: [front + '/rest/', 'http://host.docker.internal:8080/'],
      includePaths: [
        '^http:\\/\\/host\\.docker\\.internal:3000\\/rest(/.*)?(\\?.*)?$',
        '^http:\\/\\/host\\.docker\\.internal:3000\\/(#.*)?$',
        '^http:\\/\\/host\\.docker\\.internal:8080(/.*)?$',
      ],
    })
  })
})

describe('katanaScopeRegexes', () => {
  const front = 'http://host.docker.internal:3000'

  it('is empty when unrestricted; otherwise roots, exact seeds (fragment allowed) and the JS bundles', () => {
    expect(katanaScopeRegexes({ seedUrls: [front + '/'], front, prefixes: [] })).toEqual([])
    expect(
      katanaScopeRegexes({ seedUrls: [front + '/#/'], front, prefixes: ['/rest', '/app'] }),
    ).toEqual([
      '^http:\\/\\/host\\.docker\\.internal:3000\\/rest(/.*)?(\\?.*)?$',
      '^http:\\/\\/host\\.docker\\.internal:3000\\/app(/.*)?(\\?.*)?$',
      '^http:\\/\\/host\\.docker\\.internal:3000\\/(#.*)?$',
      '^http:\\/\\/host\\.docker\\.internal:3000\\/.*\\.m?js(\\?.*)?$',
    ])
  })
})
