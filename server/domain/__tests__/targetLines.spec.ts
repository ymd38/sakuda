import { describe, expect, it } from 'vitest'
import { mergeTargetLines, removeTargetLine, urlToTargetLine } from '#shared/utils/targetLines'

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

  it('prefixes a non-GET method (uppercased), never GET', () => {
    expect(urlToTargetLine(site, 'http://localhost:3000/x', 'POST')).toBe('POST /x')
    expect(urlToTargetLine(site, 'http://localhost:3000/x', 'get')).toBe('/x')
    expect(urlToTargetLine(site, 'http://localhost:8080/v1/users', 'delete')).toBe(
      'DELETE api:/v1/users',
    )
  })

  it('returns null for another origin, an unparsable value, api origin without apiBaseUrl, or an unsupported method', () => {
    expect(urlToTargetLine(site, 'http://evil.example/x')).toBeNull()
    expect(urlToTargetLine(site, 'nope')).toBeNull()
    expect(urlToTargetLine({ ...site, apiBaseUrl: null }, 'http://localhost:8080/v1')).toBeNull()
    // an unsupported verb is never offered for saving (mergeTargetLines rejects atomically)
    expect(urlToTargetLine(site, 'http://localhost:3000/x', 'TRACE')).toBeNull()
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

  it('rejects invalid lines (incl. unsupported methods) without merging anything', () => {
    const r = mergeTargetLines('/\n', ['/ok', 'http://absolute.example/x', 'TRACE /x'])
    expect(r.invalid).toEqual(['http://absolute.example/x', 'TRACE /x'])
    expect(r.added).toEqual([])
    expect(r.text).toBe('/\n')
  })

  it('keys on method|base|path: a POST coexists with a saved GET, a re-saved GET (or bare) is a no-op', () => {
    const r = mergeTargetLines('/x\n', ['POST /x', 'GET /x', '/x', 'POST /x'])
    expect(r.added).toEqual(['POST /x'])
    expect(r.skipped).toEqual(['GET /x', '/x', 'POST /x'])
    expect(r.text).toBe('/x\nPOST /x\n')
  })
})

describe('removeTargetLine', () => {
  it('removes the matching line and keeps comments, blanks and the other lines verbatim', () => {
    const existing = '# mine\n/\n\n/login\nPOST /login\n'
    const r = removeTargetLine(existing, '/login')
    expect(r).toEqual({ text: '# mine\n/\n\nPOST /login\n', removed: true, invalid: false })
  })

  it('matches by method|base|path: bare, GET and lowercase forms are the same line; POST is not', () => {
    const existing = '/x\nPOST /x\napi:/x\n'
    expect(removeTargetLine(existing, 'GET /x').text).toBe('POST /x\napi:/x\n')
    expect(removeTargetLine(existing, 'get /x').text).toBe('POST /x\napi:/x\n')
    expect(removeTargetLine(existing, 'api:/x').text).toBe('/x\nPOST /x\n')
    expect(removeTargetLine(existing, 'POST /x').text).toBe('/x\napi:/x\n')
  })

  it('drops every duplicate of the same identity, so the target is really un-saved', () => {
    // a hand-edited list can hold one target twice; one "saved" badge, one Remove
    expect(removeTargetLine('/x\nGET /x\n/y\nget /x\n', '/x')).toEqual({
      text: '/y\n',
      removed: true,
      invalid: false,
    })
  })

  it('is a no-op (removed: false, text unchanged) when the line is not saved', () => {
    const existing = '/\n/login\n'
    expect(removeTargetLine(existing, '/missing')).toEqual({
      text: existing,
      removed: false,
      invalid: false,
    })
  })

  it('flags an invalid line and removes nothing', () => {
    const existing = '/\n/login\n'
    expect(removeTargetLine(existing, 'http://absolute.example/x')).toEqual({
      text: existing,
      removed: false,
      invalid: true,
    })
    expect(removeTargetLine(existing, 'TRACE /login').invalid).toBe(true)
  })
})
