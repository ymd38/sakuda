import { describe, expect, it } from 'vitest'
import { isLocalHost, isLocalUrl, siteRequiresConfirmation } from '#shared/utils/localHost'

describe('isLocalHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    '127.0.0.1',
    '::1',
    '[::1]',
    'host.docker.internal',
    'dev.local',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '127.5.5.5',
  ])('%s is local', (h) => expect(isLocalHost(h)).toBe(true))
  it.each([
    'example.com',
    'staging.example.com',
    '172.32.0.1',
    '8.8.8.8',
    '11.0.0.1',
    'localhost.example.com',
  ])('%s is not local', (h) => expect(isLocalHost(h)).toBe(false))
})

describe('siteRequiresConfirmation', () => {
  it('false when both URLs are local', () =>
    expect(siteRequiresConfirmation('http://localhost:3000', 'http://127.0.0.1:8080')).toBe(false))
  it('true when either URL is non-local', () => {
    expect(siteRequiresConfirmation('https://app.example.com', null)).toBe(true)
    expect(siteRequiresConfirmation('http://localhost:3000', 'https://api.example.com')).toBe(true)
  })
  it('isLocalUrl is false for unparsable urls', () => expect(isLocalUrl('nope')).toBe(false))
})
