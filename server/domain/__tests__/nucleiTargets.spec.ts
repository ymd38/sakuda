import { describe, expect, it } from 'vitest'
import {
  expandNucleiTargets,
  zapFeHashRouteTargets,
  zapFeRequestTargets,
  type NucleiTargetSite,
} from '../nucleiTargets'

const site: NucleiTargetSite = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:8080',
  nucleiPaths: '/\napi:/v1/users\n# comment\n/login',
  excludePaths: '',
}

describe('expandNucleiTargets', () => {
  it('defaults to the base URL roots when no paths are configured', () => {
    const defaulted = expandNucleiTargets({ ...site, nucleiPaths: '' })
    expect(defaulted.urls).toEqual(['http://localhost:3000/', 'http://localhost:8080/'])
    expect(defaulted.configured).toBe(false)
    expect(expandNucleiTargets(site).configured).toBe(true)
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

  it('keeps only GET lines, counts non-GET in skippedMethods (before dedupe/exclusion), and never downgrades', () => {
    const r = expandNucleiTargets({
      ...site,
      nucleiPaths: '/get\nPOST /p\nPOST /p\nDELETE /d\napi:/g\nHEAD /h',
    })
    expect(r.urls).toEqual(['http://localhost:3000/get', 'http://localhost:8080/g'])
    expect(r.skippedMethods).toEqual({ POST: 2, DELETE: 1, HEAD: 1 })
    expect(r.configured).toBe(true)
  })

  it('does not expose a skipped non-GET path via excluded', () => {
    const r = expandNucleiTargets({ ...site, nucleiPaths: 'POST /secret', excludePaths: '/secret' })
    expect(r.excluded).toEqual([])
    expect(r.skippedMethods).toEqual({ POST: 1 })
  })

  it('the root fallback (no saved lines) is GET and reports no skips', () => {
    const r = expandNucleiTargets({ ...site, nucleiPaths: '' })
    expect(r.configured).toBe(false)
    expect(r.skippedMethods).toEqual({})
  })
})

describe('zapFeRequestTargets', () => {
  it('returns [] when no target lines are configured — the root fallback is not a target', () => {
    expect(zapFeRequestTargets({ ...site, nucleiPaths: '' })).toEqual([])
    expect(zapFeRequestTargets({ ...site, nucleiPaths: '# only a comment' })).toEqual([])
  })

  it('keeps front-origin targets only: no api: lines, no hash routes', () => {
    expect(
      zapFeRequestTargets({
        ...site,
        nucleiPaths: '/\n/search?q=\napi:/v1/users\n/#/search?q=\n/greet?name=a#top',
      }),
    ).toEqual(['http://localhost:3000/', 'http://localhost:3000/search?q='])
  })

  it('applies the exclude paths the same way as nuclei', () => {
    expect(zapFeRequestTargets({ ...site, excludePaths: '/login' })).toEqual([
      'http://localhost:3000/',
    ])
  })
})

describe('zapFeHashRouteTargets', () => {
  it('returns [] when no target lines are configured', () => {
    expect(zapFeHashRouteTargets({ ...site, nucleiPaths: '' })).toEqual([])
    expect(zapFeHashRouteTargets({ ...site, nucleiPaths: '# only a comment' })).toEqual([])
  })

  it('keeps only front-origin targets that contain "#" — the complement of zapFeRequestTargets', () => {
    const s = {
      ...site,
      nucleiPaths: '/\n/search?q=\napi:/v1/users\n/#/search?q=\n/#/track?id=',
    }
    expect(zapFeHashRouteTargets(s)).toEqual([
      'http://localhost:3000/#/search?q=',
      'http://localhost:3000/#/track?id=',
    ])
    // request targets and hash-route targets partition the front-origin lines
    expect(zapFeRequestTargets(s)).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/search?q=',
    ])
  })

  it('drops api: hash lines (they resolve to the API origin, not the front)', () => {
    expect(
      zapFeHashRouteTargets({
        ...site,
        nucleiPaths: 'api:/#/x\n/#/keep?q=',
      }),
    ).toEqual(['http://localhost:3000/#/keep?q='])
  })
})
