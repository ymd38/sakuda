import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import type { Env } from '../config/env'
import type { Db } from '../db/client'
import { engineRuns, findings, scans } from '../db/schema'
import { buildFingerprint } from '../domain/fingerprint'
import type { HeaderCipher } from '../domain/headerCipher'
import { orderEngines } from '../engines'
import { EngineError, type EngineRunner } from '../engines/types'
import type { Logger } from '../lib/logger'
import { loadSiteWithHeaders } from './siteService'
import type { Engine } from '#shared/types/api'
import { emptyCounts } from '#shared/utils/severity'

export interface ScanRunnerDeps {
  db: Db
  env: Env
  cipher: HeaderCipher
  runners: Record<Engine, EngineRunner>
  logger: Logger
  now: () => Date
  id: () => string
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function runScan(
  deps: ScanRunnerDeps,
  scanId: string,
  signal: AbortSignal,
): Promise<void> {
  const { db, logger } = deps
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get()
  if (!scan) {
    logger.error({ scanId }, 'scan vanished before run')
    return
  }
  const site = loadSiteWithHeaders(
    { db, cipher: deps.cipher, now: deps.now, id: deps.id },
    scan.siteId,
  )
  const finish = (status: 'done' | 'failed', error: string | null) =>
    db
      .update(scans)
      .set({ status, error, finishedAt: deps.now().toISOString() })
      .where(eq(scans.id, scanId))
      .run()
  if (!site) {
    finish('failed', 'site was deleted before the scan started')
    return
  }
  if (site.requiresConfirmation && !site.nonLocalConfirmed) {
    finish('failed', 'site targets a non-local host without confirmation')
    return
  }
  const log = logger.child({ scanId, siteId: site.id })
  let doneCount = 0
  let failedCount = 0
  for (const engine of orderEngines(scan.engines)) {
    if (signal.aborted) {
      failedCount++
      break
    }
    const runId = deps.id()
    const startedAt = deps.now().toISOString()
    db.insert(engineRuns)
      .values({
        id: runId,
        scanId,
        engine,
        status: 'running',
        startedAt,
        counts: emptyCounts(),
        meta: {},
        warnings: [],
      })
      .run()
    const workDir = join(deps.env.scansDir, scanId, engine)
    try {
      const out = await deps.runners[engine]({
        scanId,
        engine,
        site,
        workDir,
        env: deps.env,
        logger: log,
        signal,
      })
      db.transaction((tx) => {
        tx.update(engineRuns)
          .set({
            status: 'done',
            finishedAt: deps.now().toISOString(),
            exitCode: out.exitCode,
            signal: out.signal,
            counts: out.counts,
            meta: out.meta,
            warnings: out.warnings,
          })
          .where(eq(engineRuns.id, runId))
          .run()
        for (const chunk of chunks(out.findings, 200))
          tx.insert(findings)
            .values(
              chunk.map((f) => ({
                id: deps.id(),
                scanId,
                engineRunId: runId,
                ...f,
                fingerprint: buildFingerprint(f),
              })),
            )
            .run()
      })
      doneCount++
      log.info({ engine, counts: out.counts, findings: out.findings.length }, 'engine done')
    } catch (e) {
      const message =
        e instanceof EngineError && e.runbook
          ? `${e.message}\nRunbook: ${e.runbook}`
          : e instanceof Error
            ? e.message
            : String(e)
      db.update(engineRuns)
        .set({ status: 'failed', finishedAt: deps.now().toISOString(), error: message })
        .where(eq(engineRuns.id, runId))
        .run()
      failedCount++
      log.error({ engine, err: e }, 'engine failed')
    }
  }
  if (signal.aborted) finish('failed', 'aborted: server shutting down')
  else if (doneCount === 0) finish('failed', `all ${failedCount} engine run(s) failed`)
  else finish('done', failedCount ? `${failedCount} engine run(s) failed` : null)
}
