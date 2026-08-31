import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import type { Env } from '../config/env'
import type { Db } from '../db/client'
import { discoveries } from '../db/schema'
import type { SiteCipher } from '../domain/headerCipher'
import { EngineError, type DiscoverRunner } from '../engines/types'
import type { Logger } from '../lib/logger'
import { loadSiteWithHeaders } from './siteService'

export interface DiscoveryRunnerDeps {
  db: Db
  env: Env
  cipher: SiteCipher
  discover: DiscoverRunner
  logger: Logger
  now: () => Date
  id: () => string
}

/** Runs one claimed discovery to a terminal status. Same failure contract as
 * `runScan`: whatever happens, the row ends `done` or `failed` — a row stuck
 * `running` would block the site forever (createDiscovery / createScan
 * refuse while a job is active). */
export async function runDiscovery(
  deps: DiscoveryRunnerDeps,
  discoveryId: string,
  signal: AbortSignal,
): Promise<void> {
  const { db, logger } = deps
  const row = db.select().from(discoveries).where(eq(discoveries.id, discoveryId)).get()
  if (!row) {
    logger.error({ discoveryId }, 'discovery vanished before run')
    return
  }
  let finished = false
  const finish = (
    status: 'done' | 'failed',
    error: string | null,
    result?: { urls: typeof row.urls; meta: typeof row.meta; warnings: string[] },
  ): void => {
    if (finished) return
    finished = true
    try {
      db.update(discoveries)
        .set({ status, error, finishedAt: deps.now().toISOString(), ...result })
        .where(eq(discoveries.id, discoveryId))
        .run()
    } catch (e) {
      logger.error({ discoveryId, err: e }, 'failed to write final discovery status')
    }
  }
  try {
    const site = loadSiteWithHeaders(
      { db, cipher: deps.cipher, now: deps.now, id: deps.id },
      row.siteId,
    )
    if (!site) {
      finish('failed', 'site was deleted before the discovery started')
      return
    }
    if (site.requiresConfirmation && !site.nonLocalConfirmed) {
      finish('failed', 'site targets a non-local host without confirmation')
      return
    }
    if (signal.aborted) {
      finish('failed', 'aborted: server shutting down')
      return
    }
    const log = logger.child({ discoveryId, siteId: site.id })
    try {
      const out = await deps.discover({
        discoveryId,
        site,
        workDir: join(deps.env.discoveriesDir, discoveryId),
        env: deps.env,
        logger: log,
        signal,
      })
      finish('done', null, { urls: out.urls, meta: out.meta, warnings: out.warnings })
      log.info({ urlCount: out.urls.length }, 'discovery done')
    } catch (e) {
      const message =
        e instanceof EngineError && e.runbook
          ? `${e.message}\nRunbook: ${e.runbook}`
          : e instanceof Error
            ? e.message
            : String(e)
      finish('failed', message)
      log.error({ err: e }, 'discovery failed')
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error({ discoveryId, err: e }, 'discovery runner crashed')
    finish('failed', `discovery runner crashed: ${message}`)
  }
}
