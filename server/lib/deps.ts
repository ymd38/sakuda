import { randomUUID } from 'node:crypto'
import { getEnv } from '../config/env'
import { getDb } from '../db/client'
import { createSiteCipher, type SiteCipher } from '../domain/headerCipher'
import type { SiteServiceDeps } from '../services/siteService'

let cipher: SiteCipher | undefined

function getCipher(): SiteCipher {
  cipher ??= createSiteCipher(getEnv().encryptionKey)
  return cipher
}

export function siteDeps(): SiteServiceDeps {
  return { db: getDb(), cipher: getCipher(), now: () => new Date(), id: randomUUID }
}
