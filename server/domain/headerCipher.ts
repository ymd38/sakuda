import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { z } from 'zod'
import { BrowserStorageSchema, type BrowserStorageItem } from '#shared/schemas/browserStorage'
import { HeadersSchema, type Header } from '#shared/schemas/headers'

const VERSION = 1
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export class InvalidKeyError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args)
    this.name = 'InvalidKeyError'
  }
}

export class DecryptError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args)
    this.name = 'DecryptError'
  }
}

/** AES-256-GCM envelope for one kind of per-site secret:
 * `version(1) || nonce(12) || ciphertext || tag(16)`, with the site id (and,
 * for anything but the original headers, a purpose label) as AAD so an
 * envelope can never be replayed onto another site or another field. */
export interface SecretCipher<T> {
  seal(value: T, siteId: string): Buffer
  open(envelope: Buffer, siteId: string): T
}

export type HeaderCipher = SecretCipher<Header[]>
export type BrowserStorageCipher = SecretCipher<BrowserStorageItem[]>

/** Every per-site secret sakuda stores, sealed with the same key. */
export interface SiteCipher {
  headers: HeaderCipher
  browserStorage: BrowserStorageCipher
}

interface SecretCipherSpec<T> {
  schema: z.ZodType<T>
  /** Rejected on seal — an empty secret is stored as NULL, never as an envelope. */
  isEmpty: (value: T) => boolean
  emptyMessage: string
  /** Mixed into the AAD. Omitted for headers so envelopes sealed before
   * this abstraction existed still open. */
  purpose?: string
}

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== KEY_LEN || key.toString('base64') !== keyBase64) {
    throw new InvalidKeyError(`encryption key must be canonical base64 of exactly ${KEY_LEN} bytes`)
  }
  return key
}

function aad(version: number, siteId: string, purpose: string | undefined): Buffer {
  const label = purpose === undefined ? siteId : `${siteId}|${purpose}`
  return Buffer.concat([Buffer.from([version]), Buffer.from(label, 'utf8')])
}

/** The single encryption path for every per-site secret (headers, browser
 * storage, ...): same primitive, same envelope, same failure semantics. */
export function createSecretCipher<T>(
  keyBase64: string,
  spec: SecretCipherSpec<T>,
): SecretCipher<T> {
  const key = parseKey(keyBase64)
  return {
    seal(value, siteId) {
      const parsed = spec.schema.parse(value)
      if (spec.isEmpty(parsed)) throw new Error(spec.emptyMessage)
      const nonce = randomBytes(NONCE_LEN)
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN })
      cipher.setAAD(aad(VERSION, siteId, spec.purpose))
      const ct = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()])
      return Buffer.concat([Buffer.from([VERSION]), nonce, ct, cipher.getAuthTag()])
    },

    open(envelope, siteId) {
      if (envelope.length < 1 + NONCE_LEN + TAG_LEN) throw new DecryptError('ciphertext too short')
      const version = envelope[0]
      if (version !== VERSION) throw new DecryptError(`unsupported envelope version ${version}`)
      const nonce = envelope.subarray(1, 1 + NONCE_LEN)
      const tag = envelope.subarray(envelope.length - TAG_LEN)
      const ct = envelope.subarray(1 + NONCE_LEN, envelope.length - TAG_LEN)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN })
      decipher.setAAD(aad(version, siteId, spec.purpose))
      decipher.setAuthTag(tag)
      let plain: string
      try {
        plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
        const parsed = spec.schema.safeParse(JSON.parse(plain))
        if (!parsed.success) throw new DecryptError('decrypted secret failed validation')
        return parsed.data
      } catch (cause) {
        if (cause instanceof DecryptError) throw cause
        throw new DecryptError('decryption failed (key/AAD mismatch or tampering)', { cause })
      }
    },
  }
}

export function createHeaderCipher(keyBase64: string): HeaderCipher {
  return createSecretCipher(keyBase64, {
    schema: HeadersSchema,
    isEmpty: (h) => h.length === 0,
    emptyMessage: 'no headers to encrypt',
  })
}

export function createBrowserStorageCipher(keyBase64: string): BrowserStorageCipher {
  return createSecretCipher(keyBase64, {
    schema: BrowserStorageSchema,
    isEmpty: (s) => s.length === 0,
    emptyMessage: 'no browser storage items to encrypt',
    purpose: 'browserStorage',
  })
}

export function createSiteCipher(keyBase64: string): SiteCipher {
  return {
    headers: createHeaderCipher(keyBase64),
    browserStorage: createBrowserStorageCipher(keyBase64),
  }
}

export function headersToNucleiArgs(headers: Header[]): string[] {
  return headers.flatMap((h) => ['-H', `${h.name}: ${h.value}`])
}
