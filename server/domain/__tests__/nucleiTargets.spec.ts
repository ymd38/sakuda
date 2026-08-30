import { describe, expect, it } from 'vitest'
import { expandNucleiTargets, type NucleiTargetSite } from '../nucleiTargets'

const site: NucleiTargetSite = {
  frontBaseUrl: 'http://localhost:3000',
  apiBaseUrl: 'http://localhost:8080',
  nucleiPaths: '/\napi:/v1/users\n# comment\n/login',
  excludePaths: '',
}

describe('expandNucleiTargets', () => {
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
