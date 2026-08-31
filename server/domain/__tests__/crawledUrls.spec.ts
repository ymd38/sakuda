import { describe, expect, it } from 'vitest'
import { classifyCrawledUrl, normalizeCrawledUrls, type CrawlScopeSite } from '../crawledUrls'

const site: CrawlScopeSite = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:8080',
  excludePaths: '',
}

describe('classifyCrawledUrl', () => {
  it('keeps URLs on the front or api origin, stripping the fragment', () => {
    expect(classifyCrawledUrl(site, 'http://localhost:3000/login#top')).toEqual({
      kind: 'ok',
      url: 'http://localhost:3000/login',
    })
    expect(classifyCrawledUrl(site, 'http://localhost:8080/v1/users?page=2')).toEqual({
      kind: 'ok',
      url: 'http://localhost:8080/v1/users?page=2',
    })
  })

  it('drops other origins, unparsable strings, assets, dev noise, and excluded paths', () => {
    expect(classifyCrawledUrl(site, 'http://evil.example/x')).toEqual({
      kind: 'dropped',
      reason: 'sameOriginOnly',
    })
    expect(classifyCrawledUrl(site, 'not a url')).toEqual({ kind: 'dropped', reason: 'invalid' })
    for (const u of [
      'http://localhost:3000/app.js',
      'http://localhost:3000/style.css',
      'http://localhost:3000/logo.svg',
      'http://localhost:3000/_nuxt/entry.abc123.js',
      'http://localhost:3000/@vite/client',
      'http://localhost:3000/node_modules/foo/bar.mjs',
    ])
      expect(classifyCrawledUrl(site, u)).toEqual({ kind: 'dropped', reason: 'asset' })
    expect(
      classifyCrawledUrl({ ...site, excludePaths: '/admin/*' }, 'http://localhost:3000/admin/x'),
    ).toEqual({ kind: 'dropped', reason: 'excluded' })
  })

  it('drops socket.io transport URLs and stack-trace pseudo-paths as noise', () => {
    for (const u of [
      'http://localhost:3000/socket.io/?EIO=4&transport=polling&t=Q1Ld3bH',
      'http://localhost:3000/socket.io',
      'http://localhost:3000/juice-shop/build/routes/fileServer.js:69:18',
      'http://localhost:3000/node_modules/express/lib/router/index.js:286:9',
    ])
      expect(classifyCrawledUrl(site, u).kind).toBe('dropped')
    expect(
      classifyCrawledUrl(site, 'http://localhost:3000/socket.io/?EIO=4&transport=polling'),
    ).toEqual({ kind: 'dropped', reason: 'noise' })
    expect(
      classifyCrawledUrl(site, 'http://localhost:3000/build/routes/fileServer.js:69:18'),
    ).toEqual({ kind: 'dropped', reason: 'noise' })
  })
})

describe('normalizeCrawledUrls', () => {
  it('filters, dedupes in crawl order and counts every drop reason', () => {
    const { urls, dropped } = normalizeCrawledUrls({ ...site, excludePaths: '/logout' }, [
      'http://localhost:3000/',
      'http://localhost:3000/#/search',
      'http://localhost:3000/login',
      'http://localhost:3000/login',
      'http://localhost:3000/main.js',
      'http://localhost:3000/socket.io/?EIO=4',
      'http://localhost:3000/logout',
      'http://other.example/',
      '::nope::',
      'http://localhost:8080/v1/users',
    ])
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/login',
      'http://localhost:8080/v1/users',
    ])
    expect(dropped).toEqual({
      invalid: 1,
      sameOriginOnly: 1,
      asset: 1,
      noise: 1,
      excluded: 1,
      capped: 0,
    })
  })

  it('caps accepted URLs at maxUrls, counting the rest', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `http://localhost:3000/p${i}`)
    const { urls, dropped } = normalizeCrawledUrls(site, raw, { maxUrls: 2 })
    expect(urls).toEqual(['http://localhost:3000/p0', 'http://localhost:3000/p1'])
    expect(dropped.capped).toBe(3)
  })

  it('returns an empty list with zero drops for empty input', () => {
    expect(normalizeCrawledUrls(site, [])).toEqual({
      urls: [],
      dropped: { invalid: 0, sameOriginOnly: 0, asset: 0, noise: 0, excluded: 0, capped: 0 },
    })
  })
})
