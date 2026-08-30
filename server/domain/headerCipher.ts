import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { HeadersSchema, type Header } from '#shared/schemas/headers'

const VERSION = 1
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export class InvalidKeyError extends Error {}

export class DecryptError extends Error {}

export interface HeaderCipher {
  seal(headers: Header[], siteId: string): Buffer
  open(envelope: Buffer, siteId: string): Header[]
}

function aad(version: number, siteId: string): Buffer {
  return Buffer.concat([Buffer.from([version]), Buffer.from(siteId, 'utf8')])
}

export function createHeaderCipher(keyBase64: string): HeaderCipher {
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== KEY_LEN || key.toString('base64') !== keyBase64) {
    throw new InvalidKeyError(`encryption key must be canonical base64 of exactly ${KEY_LEN} bytes`)
  }

  return {
    seal(headers, siteId) {
      const parsed = HeadersSchema.parse(headers)
      if (parsed.length === 0) throw new Error('no headers to encrypt')
      const nonce = randomBytes(NONCE_LEN)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(aad(VERSION, siteId))
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
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAAD(aad(version, siteId))
      decipher.setAuthTag(tag)
      let plain: string
      try {
        plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
        const parsed = HeadersSchema.safeParse(JSON.parse(plain))
        if (!parsed.success) throw new DecryptError('decrypted headers failed validation')
        return parsed.data
      } catch (cause) {
        if (cause instanceof DecryptError) throw cause
        throw new DecryptError('decryption failed (key/AAD mismatch or tampering)', { cause })
      }
    },
  }
}

export function headersToNucleiArgs(headers: Header[]): string[] {
  return headers.flatMap((h) => ['-H', `${h.name}: ${h.value}`])
}
