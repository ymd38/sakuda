import { describe, expect, it } from 'vitest'
import {
  countSkippedMethods,
  expandNucleiTargets,
  zapFeHashRouteTargets,
  zapFeRequestTargets,
  type ExpandedTarget,
  type NucleiTargetSite,
} from '../nucleiTargets'

const site: NucleiTargetSite = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:8080',
  nucleiPaths: '/\napi:/v1/users\n# comment\n/login',
  excludePaths: '',
}

const urlsOf = (site: NucleiTargetSite) => expandNucleiTargets(site).targets.map((t) => t.url)

describe('expandNucleiTargets', () => {
  it('defaults to the base URL roots (GET) when no paths are configured', () => {
    const defaulted = expandNucleiTargets({ ...site, nucleiPaths: '' })
    expect(defaulted.targets).toEqual([
      { method: 'GET', base: 'front', url: 'http://localhost:3000/' },
      { method: 'GET', base: 'api', url: 'http://localhost:8080/' },
    ])
    expect(defaulted.configured).toBe(false)
    expect(expandNucleiTargets(site).configured).toBe(true)
    expect(urlsOf({ ...site, nucleiPaths: '# only a comment', apiBaseUrl: null })).toEqual([
      'http://localhost:3000/',
    ])
  })

  it('resolves front and api lines to the right bases, skipping comments', () => {
    const { targets, excluded } = expandNucleiTargets(site)
    expect(targets).toEqual([
      { method: 'GET', base: 'front', url: 'http://localhost:3000/' },
      { method: 'GET', base: 'api', url: 'http://localhost:8080/v1/users' },
      { method: 'GET', base: 'front', url: 'http://localhost:3000/login' },
    ])
    expect(excluded).toEqual([])
  })

  it('drops excluded GET paths into excluded', () => {
    const { targets, excluded } = expandNucleiTargets({ ...site, excludePaths: '/login' })
    expect(targets.map((t) => t.url)).toEqual([
      'http://localhost:3000/',
      'http://localhost:8080/v1/users',
    ])
    expect(excluded).toEqual(['http://localhost:3000/login'])
  })

  it('keeps every method; dedupe is method+base+url, so a POST never hides a GET', () => {
    const { targets } = expandNucleiTargets({
      ...site,
      nucleiPaths: 'POST /x\n/x\nGET /x\nPOST /x\napi:/x\n/x',
    })
    expect(targets).toEqual([
      { method: 'POST', base: 'front', url: 'http://localhost:3000/x' },
      { method: 'GET', base: 'front', url: 'http://localhost:3000/x' },
      { method: 'GET', base: 'api', url: 'http://localhost:8080/x' },
    ])
  })

  it('skips "api:" lines when apiBaseUrl is not set', () => {
    expect(urlsOf({ ...site, apiBaseUrl: null, nucleiPaths: 'api:/v1/x' })).toEqual([])
  })

  it('does not expose an excluded non-GET path via excluded (its path stays hidden)', () => {
    const r = expandNucleiTargets({ ...site, nucleiPaths: 'POST /secret', excludePaths: '/secret' })
    expect(r.excluded).toEqual([])
    // the POST target was excluded, so it is not in targets either
    expect(r.targets).toEqual([])
  })
})

describe('countSkippedMethods', () => {
  it('counts non-GET targets by method, ignoring GET', () => {
    const targets: ExpandedTarget[] = [
      { method: 'GET', base: 'front', url: 'http://x/a' },
      { method: 'POST', base: 'front', url: 'http://x/b' },
      { method: 'POST', base: 'api', url: 'http://x/c' },
      { method: 'DELETE', base: 'front', url: 'http://x/d' },
    ]
    expect(countSkippedMethods(targets)).toEqual({ POST: 2, DELETE: 1 })
    expect(countSkippedMethods([{ method: 'GET', base: 'front', url: 'http://x/a' }])).toEqual({})
  })
})

describe('zapFeRequestTargets / zapFeHashRouteTargets (over the expanded result)', () => {
  const expand = (nucleiPaths: string, excludePaths = '') =>
    expandNucleiTargets({ ...site, nucleiPaths, excludePaths })

  it('return [] when no target lines are configured — the root fallback is not a target', () => {
    expect(zapFeRequestTargets(expand(''))).toEqual([])
    expect(zapFeHashRouteTargets(expand('# only a comment'))).toEqual([])
  })

  it('return front-base non-hash targets with their method (api: lines and hash routes excluded); the caller gates non-GET', () => {
    const e = expand('/\n/search?q=\napi:/v1/users\nPOST /mut\n/#/search?q=\n/greet?name=a#top')
    // every front-base non-hash target, method included — GET and the POST
    expect(zapFeRequestTargets(e)).toEqual([
      { method: 'GET', url: 'http://localhost:3000/' },
      { method: 'GET', url: 'http://localhost:3000/search?q=' },
      { method: 'POST', url: 'http://localhost:3000/mut' },
    ])
    // any front-base GET URL carrying a fragment is a hash route
    expect(zapFeHashRouteTargets(e)).toEqual([
      'http://localhost:3000/#/search?q=',
      'http://localhost:3000/greet?name=a#top',
    ])
  })

  it('apply the exclude paths the same way as nuclei', () => {
    expect(zapFeRequestTargets(expand('', '/login'))).toEqual([])
    expect(zapFeRequestTargets(expand('/\n/login', '/login'))).toEqual([
      { method: 'GET', url: 'http://localhost:3000/' },
    ])
  })

  it('drop api: hash lines (they resolve to the API base, not the front)', () => {
    expect(zapFeHashRouteTargets(expand('api:/#/x\n/#/keep?q='))).toEqual([
      'http://localhost:3000/#/keep?q=',
    ])
  })
})
