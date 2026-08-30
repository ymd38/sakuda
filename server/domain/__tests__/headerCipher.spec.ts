import { describe, expect, it } from 'vitest'
import { randomBytes, createCipheriv } from 'node:crypto'
import {
  DecryptError,
  InvalidKeyError,
  createHeaderCipher,
  headersToNucleiArgs,
} from '../headerCipher'

const key = randomBytes(32).toString('base64')
const headers = [
  { name: 'Cookie', value: 'a=b; c=d' },
  { name: 'Authorization', value: 'Bearer x' },
]

describe('createHeaderCipher', () => {
  it('rejects a non-32-byte key', () => {
    expect(() => createHeaderCipher(randomBytes(16).toString('base64'))).toThrow(InvalidKeyError)
    expect(() => createHeaderCipher('not base64!!')).toThrow(InvalidKeyError)
  })

  it('round-trips headers; envelope = version 1 || 12B nonce || ct || 16B tag', () => {
    const c = createHeaderCipher(key)
    const env = c.seal(headers, 'site-1')
    expect(env[0]).toBe(1)
    expect(env.length).toBe(1 + 12 + JSON.stringify(headers).length + 16)
    expect(c.open(env, 'site-1')).toEqual(headers)
  })

  it('uses a fresh nonce each time', () => {
    const c = createHeaderCipher(key)
    expect(c.seal(headers, 's').equals(c.seal(headers, 's'))).toBe(false)
  })

  it('fails to open with a different siteId (AAD) or different key', () => {
    const c = createHeaderCipher(key)
    const env = c.seal(headers, 'site-1')
    expect(() => c.open(env, 'site-2')).toThrow(DecryptError)
    expect(() =>
      createHeaderCipher(randomBytes(32).toString('base64')).open(env, 'site-1'),
    ).toThrow(DecryptError)
  })

  it('fails on tampering, truncation and unknown version', () => {
    const c = createHeaderCipher(key)
    const env = c.seal(headers, 's')
    const tampered = Buffer.from(env)
    tampered[20] ^= 0xff
    expect(() => c.open(tampered, 's')).toThrow(DecryptError)
    expect(() => c.open(env.subarray(0, 20), 's')).toThrow(DecryptError)
    const v2 = Buffer.from(env)
    v2[0] = 2
    expect(() => c.open(v2, 's')).toThrow(/version/)
  })

  it('rejects invalid headers on seal', () => {
    const c = createHeaderCipher(key)
    expect(() => c.seal([{ name: 'X', value: 'a\r\nb' }], 's')).toThrow()
    expect(() => c.seal([{ name: 'X:Y', value: 'a' }], 's')).toThrow()
    expect(() => c.seal([], 's')).toThrow(/no headers/)
  })

  it('fails to open envelope with non-JSON plaintext', () => {
    const keyBuf = Buffer.from(key, 'base64')
    const siteId = 'test-site'
    const version = 1
    const nonce = randomBytes(12)
    const nonJsonPlaintext = 'not valid json'
    const aadBuf = Buffer.concat([Buffer.from([version]), Buffer.from(siteId, 'utf8')])

    const cipher = createCipheriv('aes-256-gcm', keyBuf, nonce)
    cipher.setAAD(aadBuf)
    const ct = Buffer.concat([cipher.update(nonJsonPlaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const envelope = Buffer.concat([Buffer.from([version]), nonce, ct, tag])

    const c = createHeaderCipher(key)
    expect(() => c.open(envelope, siteId)).toThrow(DecryptError)
  })

  it('headersToNucleiArgs formats -H pairs', () => {
    expect(headersToNucleiArgs(headers)).toEqual([
      '-H',
      'Cookie: a=b; c=d',
      '-H',
      'Authorization: Bearer x',
    ])
  })
})
