import { describe, expect, it } from 'vitest'
import { joinUrl, restoreLoopbackHost, rewriteLoopbackHost } from '../hostAlias'

describe('rewriteLoopbackHost', () => {
  it('rewrites localhost to the alias', () =>
    expect(rewriteLoopbackHost('http://localhost:3000/a?b', 'host.docker.internal')).toBe(
      'http://host.docker.internal:3000/a?b',
    ))
  it('rewrites 127.0.0.1 to the alias', () =>
    expect(rewriteLoopbackHost('http://127.0.0.1:3000/a?b', 'host.docker.internal')).toBe(
      'http://host.docker.internal:3000/a?b',
    ))
  it('rewrites [::1] to the alias', () =>
    expect(rewriteLoopbackHost('http://[::1]:3000/a?b', 'host.docker.internal')).toBe(
      'http://host.docker.internal:3000/a?b',
    ))
  it('leaves non-loopback hosts untouched', () =>
    expect(rewriteLoopbackHost('http://example.com:3000/a', 'host.docker.internal')).toBe(
      'http://example.com:3000/a',
    ))
  it('is the identity when alias is undefined', () =>
    expect(rewriteLoopbackHost('http://localhost:3000/a', undefined)).toBe(
      'http://localhost:3000/a',
    ))
})

describe('restoreLoopbackHost', () => {
  it('maps the alias host back to the original host', () =>
    expect(
      restoreLoopbackHost(
        'http://host.docker.internal:3000/a?b',
        'host.docker.internal',
        'localhost',
      ),
    ).toBe('http://localhost:3000/a?b'))
  it('is the identity when alias is undefined', () =>
    expect(restoreLoopbackHost('http://host.docker.internal:3000/a', undefined, 'localhost')).toBe(
      'http://host.docker.internal:3000/a',
    ))
})

describe('joinUrl', () => {
  it('joins a base without a trailing slash and a path with a leading slash', () =>
    expect(joinUrl('http://h:1', '/p')).toBe('http://h:1/p'))
  it('joins a base with a trailing slash and a path without a leading slash', () =>
    expect(joinUrl('http://h:1/', 'p')).toBe('http://h:1/p'))
})
