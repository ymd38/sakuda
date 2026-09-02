import { describe, expect, it } from 'vitest'
import {
  countParameterizedUrls,
  FUZZ_SEED_VALUE,
  isActiveScanEnabled,
  seedEmptyQueryValues,
} from '../activeScan'

describe('isActiveScanEnabled', () => {
  it('is off by default (no opt-in) even for a local site', () => {
    expect(
      isActiveScanEnabled({
        allowMutatingRequests: false,
        requiresConfirmation: false,
        nonLocalConfirmed: false,
      }),
    ).toBe(false)
  })

  it('is on when opted in and the host is local (no confirmation needed)', () => {
    expect(
      isActiveScanEnabled({
        allowMutatingRequests: true,
        requiresConfirmation: false,
        nonLocalConfirmed: false,
      }),
    ).toBe(true)
  })

  it('is on when opted in and a non-local host has been confirmed', () => {
    expect(
      isActiveScanEnabled({
        allowMutatingRequests: true,
        requiresConfirmation: true,
        nonLocalConfirmed: true,
      }),
    ).toBe(true)
  })

  it('stays off when opted in but ownership of a non-local host is not confirmed', () => {
    expect(
      isActiveScanEnabled({
        allowMutatingRequests: true,
        requiresConfirmation: true,
        nonLocalConfirmed: false,
      }),
    ).toBe(false)
  })
})

describe('countParameterizedUrls', () => {
  it('counts only URLs with a non-empty query string', () => {
    expect(
      countParameterizedUrls([
        'http://localhost:3001/',
        'http://localhost:3001/rest/products/search?q=',
        'http://localhost:3001/api/users?page=1&size=10',
        'http://localhost:3001/bare?',
        'not a url',
      ]),
    ).toBe(2)
  })

  it('returns 0 for an empty list', () => {
    expect(countParameterizedUrls([])).toBe(0)
  })
})

describe('seedEmptyQueryValues', () => {
  it('fills an empty query value with the fuzz seed so nuclei has something to mutate', () => {
    expect(seedEmptyQueryValues(['http://localhost:3001/rest/products/search?q='])).toEqual([
      `http://localhost:3001/rest/products/search?q=${FUZZ_SEED_VALUE}`,
    ])
  })

  it('leaves a parameter that already has a value untouched', () => {
    expect(seedEmptyQueryValues(['http://localhost:3001/search?q=apple'])).toEqual([
      'http://localhost:3001/search?q=apple',
    ])
  })

  it('fills only the empty parameters in a mixed query', () => {
    expect(seedEmptyQueryValues(['http://localhost:3001/x?a=&b=2&c='])).toEqual([
      `http://localhost:3001/x?a=${FUZZ_SEED_VALUE}&b=2&c=${FUZZ_SEED_VALUE}`,
    ])
  })

  it('leaves a URL with no query string untouched', () => {
    expect(seedEmptyQueryValues(['http://localhost:3001/plain'])).toEqual([
      'http://localhost:3001/plain',
    ])
  })

  it('returns an unparsable entry unchanged rather than dropping it', () => {
    expect(seedEmptyQueryValues(['not a url'])).toEqual(['not a url'])
  })
})
