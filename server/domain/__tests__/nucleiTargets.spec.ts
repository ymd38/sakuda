import { describe, expect, it } from 'vitest'
import { expandNucleiTargets, mergeCrawledTargets, type NucleiTargetSite } from '../nucleiTargets'

const site: NucleiTargetSite = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:8080',
  nucleiPaths: '/\napi:/v1/users\n# comment\n/login',
  excludePaths: '',
}

describe('expandNucleiTargets', () => {
  it('defaults to the base URL roots when no paths are configured', () => {
    expect(expandNucleiTargets({ ...site, nucleiPaths: '' }).urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:8080/',
    ])
    expect(
      expandNucleiTargets({ ...site, nucleiPaths: '# only a comment', apiBaseUrl: null }).urls,
    ).toEqual(['http://localhost:3000/'])
  })

  it('resolves front and api lines to the right bases, skipping comments', () => {
    const { urls, excluded } = expandNucleiTargets(site)
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:8080/v1/users',
      'http://localhost:3000/login',
    ])
    expect(excluded).toEqual([])
  })

  it('drops excluded paths into excluded', () => {
    const { urls, excluded } = expandNucleiTargets({ ...site, excludePaths: '/login' })
    expect(urls).toEqual(['http://localhost:3000/', 'http://localhost:8080/v1/users'])
    expect(excluded).toEqual(['http://localhost:3000/login'])
  })

  it('removes duplicate urls, preserving first-seen order', () => {
    const { urls } = expandNucleiTargets({
      ...site,
      nucleiPaths: '/login\n/login\napi:/v1/users',
    })
    expect(urls).toEqual(['http://localhost:3000/login', 'http://localhost:8080/v1/users'])
  })

  it('skips "api:" lines when apiBaseUrl is not set', () => {
    const { urls } = expandNucleiTargets({ ...site, apiBaseUrl: null, nucleiPaths: 'api:/v1/x' })
    expect(urls).toEqual([])
  })
})

describe('mergeCrawledTargets', () => {
  const base = ['http://localhost:3000/']

  it('keeps crawled URLs on the front or api origin, appended after base', () => {
    const { urls, dropped } = mergeCrawledTargets(site, base, [
      'http://localhost:3000/login',
      'http://localhost:8080/v1/users',
    ])
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/login',
      'http://localhost:8080/v1/users',
    ])
    expect(dropped.sameOriginOnly).toBe(0)
  })

  it('drops crawled URLs on a different origin, counting them', () => {
    const { urls, dropped } = mergeCrawledTargets(site, base, ['http://evil.example/x'])
    expect(urls).toEqual(['http://localhost:3000/'])
    expect(dropped.sameOriginOnly).toBe(1)
  })

  it('strips URL fragments before adding', () => {
    const { urls } = mergeCrawledTargets(site, base, ['http://localhost:3000/page#section'])
    expect(urls).toEqual(['http://localhost:3000/', 'http://localhost:3000/page'])
  })

  it('drops paths matching excludePaths, counting them', () => {
    const { urls, dropped } = mergeCrawledTargets({ ...site, excludePaths: '/admin/*' }, base, [
      'http://localhost:3000/admin/dashboard',
    ])
    expect(urls).toEqual(['http://localhost:3000/'])
    expect(dropped.excluded).toBe(1)
  })

  it('drops static assets and dev-server noise by extension/path, counting them', () => {
    const { urls, dropped } = mergeCrawledTargets(site, base, [
      'http://localhost:3000/app.js',
      'http://localhost:3000/style.css',
      'http://localhost:3000/logo.svg',
      'http://localhost:3000/_nuxt/entry.abc123.js',
      'http://localhost:3000/@vite/client',
      'http://localhost:3000/@fs/some/path',
      'http://localhost:3000/node_modules/foo/bar.mjs',
    ])
    expect(urls).toEqual(['http://localhost:3000/'])
    expect(dropped.asset).toBe(7)
  })

  it('dedupes crawled URLs against base and against themselves, preserving order', () => {
    const { urls } = mergeCrawledTargets(site, base, [
      'http://localhost:3000/',
      'http://localhost:3000/login',
      'http://localhost:3000/login',
    ])
    expect(urls).toEqual(['http://localhost:3000/', 'http://localhost:3000/login'])
  })

  it('caps crawled additions at maxCrawled, counting the rest', () => {
    const crawled = Array.from({ length: 5 }, (_, i) => `http://localhost:3000/p${i}`)
    const { urls, dropped } = mergeCrawledTargets(site, base, crawled, { maxCrawled: 2 })
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/p0',
      'http://localhost:3000/p1',
    ])
    expect(dropped.capped).toBe(3)
  })

  it('drops invalid URLs without throwing, counting them', () => {
    const { urls, dropped } = mergeCrawledTargets(site, base, [
      'not a url',
      'http://localhost:3000/ok',
    ])
    expect(urls).toEqual(['http://localhost:3000/', 'http://localhost:3000/ok'])
    expect(dropped.invalid).toBe(1)
  })

  it('returns just base when crawled is empty', () => {
    const { urls, dropped } = mergeCrawledTargets(site, base, [])
    expect(urls).toEqual(base)
    expect(dropped).toEqual({ sameOriginOnly: 0, excluded: 0, asset: 0, capped: 0, invalid: 0 })
  })
})
