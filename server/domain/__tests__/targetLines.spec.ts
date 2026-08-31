import { describe, expect, it } from 'vitest'
import { mergeTargetLines, urlToTargetLine } from '#shared/utils/targetLines'

const site = { frontBaseUrl: 'http://localhost:3000', apiBaseUrl: 'http://localhost:8080' }

describe('urlToTargetLine', () => {
  it('maps a front-origin URL to a relative path line, keeping the query', () => {
    expect(urlToTargetLine(site, 'http://localhost:3000/rest/products/search?q=')).toBe(
      '/rest/products/search?q=',
    )
    expect(urlToTargetLine(site, 'http://localhost:3000/')).toBe('/')
  })

  it('maps an api-origin URL to an "api:" line', () => {
    expect(urlToTargetLine(site, 'http://localhost:8080/v1/users')).toBe('api:/v1/users')
  })

  it('returns null for another origin, an unparsable value, or api origin without apiBaseUrl', () => {
    expect(urlToTargetLine(site, 'http://evil.example/x')).toBeNull()
    expect(urlToTargetLine(site, 'nope')).toBeNull()
    expect(urlToTargetLine({ ...site, apiBaseUrl: null }, 'http://localhost:8080/v1')).toBeNull()
  })
})

describe('mergeTargetLines', () => {
  it('appends new lines after the existing text, preserving comments verbatim', () => {
    const r = mergeTargetLines('# top\n/\n', ['/login', 'api:/v1/users'])
    expect(r.text).toBe('# top\n/\n/login\napi:/v1/users\n')
    expect(r.added).toEqual(['/login', 'api:/v1/users'])
    expect(r.skipped).toEqual([])
    expect(r.invalid).toEqual([])
  })

  it('skips lines already present and duplicates within the input', () => {
    const r = mergeTargetLines('/\n/login', ['/login', '/login', ' /new '])
    expect(r.text).toBe('/\n/login\n/new\n')
    expect(r.added).toEqual(['/new'])
    expect(r.skipped).toEqual(['/login', '/login'])
  })

  it('starts a fresh list when the existing text is empty', () => {
    expect(mergeTargetLines('', ['/a']).text).toBe('/a\n')
    expect(mergeTargetLines('   \n', ['/a']).text).toBe('/a\n')
  })

  it('returns the existing text untouched when nothing new is added', () => {
    const r = mergeTargetLines('/\n', ['/', ''])
    expect(r.text).toBe('/\n')
    expect(r.added).toEqual([])
  })

  it('rejects invalid lines without merging anything', () => {
    const r = mergeTargetLines('/\n', ['/ok', 'http://absolute.example/x', 'no-slash'])
    expect(r.invalid).toEqual(['http://absolute.example/x', 'no-slash'])
    expect(r.added).toEqual([])
    expect(r.text).toBe('/\n')
  })
})
