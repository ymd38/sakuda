import { randomUUID } from 'node:crypto'
import { getEnv } from '../config/env'
import { getDb } from '../db/client'
import { createHeaderCipher, type HeaderCipher } from '../domain/headerCipher'
import type { SiteServiceDeps } from '../services/siteService'

let cipher: HeaderCipher | undefined

function getCipher(): HeaderCipher {
  cipher ??= createHeaderCipher(getEnv().encryptionKey)
  return cipher
}

export function siteDeps(): SiteServiceDeps {
  return { db: getDb(), cipher: getCipher(), now: () => new Date(), id: randomUUID }
}
