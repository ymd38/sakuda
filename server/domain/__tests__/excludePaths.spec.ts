import { describe, expect, it } from 'vitest'
import {
  globToPathRegexSource,
  parseExcludePatterns,
  pathMatchesAny,
  toZapExcludeRegex,
  zapExcludeRegexes,
} from '../excludePaths'

describe('excludePaths', () => {
  it('parses lines, skipping blanks and comments', () =>
    expect(parseExcludePatterns('/auth/logout\n\n# c\n */register ')).toEqual([
      '/auth/logout',
      '*/register',
    ]))
  it('glob * spans slashes, other regex chars are escaped', () => {
    expect(globToPathRegexSource('/a.b/*')).toBe('^/a\\.b/.*$')
    expect(pathMatchesAny('/api/x/register', ['*/register'])).toBe(true)
    expect(pathMatchesAny('/auth/logout-history', ['/auth/logout'])).toBe(false)
    expect(pathMatchesAny('/auth/logout', ['/auth/logout'])).toBe(true)
  })
  it('ZAP regex is anchored on origin and tolerates a query string', () => {
    const re = new RegExp(toZapExcludeRegex('/auth/refresh'))
    expect(re.test('http://localhost:8080/auth/refresh')).toBe(true)
    expect(re.test('http://localhost:8080/auth/refresh?x=1')).toBe(true)
    expect(re.test('http://localhost:8080/x/auth/refresh')).toBe(false)
  })

  describe('zapExcludeRegexes', () => {
    const matches = (regexes: string[], url: string) => regexes.some((r) => new RegExp(r).test(url))

    it('always excludes socket.io, even when the site configured nothing', () => {
      const regexes = zapExcludeRegexes('')
      expect(regexes).toEqual(['^https?://[^/]+/socket\\.io.*(\\?.*)?$'])
      for (const u of [
        'http://localhost:3000/socket.io',
        'http://localhost:3000/socket.io/',
        'http://localhost:3000/socket.io/?EIO=4&transport=polling&t=Q1Ld3bH',
      ])
        expect(matches(regexes, u)).toBe(true)
      expect(matches(regexes, 'http://localhost:3000/socket')).toBe(false)
    })

    it('keeps the site patterns and appends the noise ones', () =>
      expect(zapExcludeRegexes('/auth/logout\n/admin/*')).toEqual([
        '^https?://[^/]+/auth/logout(\\?.*)?$',
        '^https?://[^/]+/admin/.*(\\?.*)?$',
        '^https?://[^/]+/socket\\.io.*(\\?.*)?$',
      ]))

    it('does not double a noise pattern the site already lists', () =>
      expect(zapExcludeRegexes('/socket.io*')).toEqual(['^https?://[^/]+/socket\\.io.*(\\?.*)?$']))
  })
})
