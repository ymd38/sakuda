import { describe, expect, it } from 'vitest'
import {
  classifyCrawledUrl,
  isApiCall,
  normalizeCrawledUrls,
  spaLikelyDidNotStart,
  type CrawlScopeSite,
} from '../crawledUrls'

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

describe('isApiCall', () => {
  it('treats clear API signals as API calls', () => {
    expect(isApiCall('POST', 'http://localhost:3000/login')).toBe(true) // non-GET
    expect(isApiCall('GET', 'http://localhost:3000/api/users')).toBe(true)
    expect(isApiCall('GET', 'http://localhost:3000/rest/basket/6')).toBe(true)
    expect(isApiCall('GET', 'http://localhost:3000/graphql')).toBe(true)
    expect(isApiCall('GET', 'http://localhost:3000/data/config.json')).toBe(true)
    expect(isApiCall('GET', 'http://localhost:3000/rest/products/search?q=')).toBe(true) // /rest marker
  })

  it('does not treat assets, HTML pages, or extensionless GET routes as API calls (warn side)', () => {
    expect(isApiCall('GET', 'http://localhost:3000/_nuxt/entry.js')).toBe(false) // asset
    expect(isApiCall('GET', 'http://localhost:3000/main.css')).toBe(false) // asset
    expect(isApiCall('GET', 'http://localhost:3000/')).toBe(false) // root HTML
    expect(isApiCall('GET', 'http://localhost:3000/about')).toBe(false) // SPA route / HTML
    // a query string alone is not a signal: page navigations carry them too,
    // and counting one as an API call would wrongly suppress the warning
    expect(isApiCall('GET', 'http://localhost:3000/about?ref=x')).toBe(false)
  })

  it('classifies an unparsable URL as not an API call', () => {
    expect(isApiCall('GET', 'not a url')).toBe(false)
  })
})

describe('spaLikelyDidNotStart', () => {
  const asset = { method: 'GET', url: 'http://localhost:3000/_nuxt/entry.js' }
  const html = { method: 'GET', url: 'http://localhost:3000/about' }
  const api = { method: 'GET', url: 'http://localhost:3000/rest/products/search?q=' }

  it('(a) is false when at least one Ajax entry is an API call', () => {
    expect(spaLikelyDidNotStart([html, api])).toBe(false)
  })

  it('(b) is true when Ajax entries are only assets / HTML pages', () => {
    expect(spaLikelyDidNotStart([asset, html])).toBe(true)
  })

  it('(c) is false when there are no Ajax entries at all (no duplicate of the empty-crawl warning)', () => {
    expect(spaLikelyDidNotStart([])).toBe(false)
  })
})
