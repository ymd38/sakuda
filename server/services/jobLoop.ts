import { claimNextQueuedDiscovery } from './discoveryService'
import { runDiscovery, type DiscoveryRunnerDeps } from './discoveryRunner'
import { claimNextQueuedScan } from './scanService'
import { runScan, type ScanRunnerDeps } from './scanRunner'

export interface JobLoop {
  start(): void
  stop(): Promise<void>
  isBusy(): boolean
}

export type JobLoopDeps = ScanRunnerDeps & DiscoveryRunnerDeps & { pollMs: number }

/** Single sequential worker over two queues. Scans are claimed before
 * discoveries so a queued scan is never starved by repeated discoveries;
 * within a queue, oldest first. */
export function createJobLoop(deps: JobLoopDeps): JobLoop {
  const ac = new AbortController()
  let timer: NodeJS.Timeout | null = null
  let current: Promise<void> | null = null
  let stopped = false

  function claimNext(): (() => Promise<void>) | null {
    const scanId = claimNextQueuedScan(deps.db, deps.now)
    if (scanId)
      return () =>
        runScan(deps, scanId, ac.signal).catch((e: unknown) =>
          deps.logger.error({ scanId, err: e }, 'runScan crashed'),
        )
    const discoveryId = claimNextQueuedDiscovery(deps.db, deps.now)
    if (discoveryId)
      return () =>
        runDiscovery(deps, discoveryId, ac.signal).catch((e: unknown) =>
          deps.logger.error({ discoveryId, err: e }, 'runDiscovery crashed'),
        )
    return null
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const job = claimNext()
    if (job) {
      current = job()
      await current
      current = null
    }
    if (!stopped) timer = setTimeout(() => void tick(), job ? 0 : deps.pollMs)
  }

  return {
    start() {
      stopped = false
      timer = setTimeout(() => void tick(), 0)
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      ac.abort()
      await current
    },
    isBusy: () => current !== null,
  }
}
