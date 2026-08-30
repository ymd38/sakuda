import { claimNextQueuedScan } from './scanService'
import { runScan, type ScanRunnerDeps } from './scanRunner'

export interface JobLoop {
  start(): void
  stop(): Promise<void>
  isBusy(): boolean
}

export function createJobLoop(deps: ScanRunnerDeps & { pollMs: number }): JobLoop {
  const ac = new AbortController()
  let timer: NodeJS.Timeout | null = null
  let current: Promise<void> | null = null
  let stopped = false

  async function tick(): Promise<void> {
    if (stopped) return
    const scanId = claimNextQueuedScan(deps.db, deps.now)
    if (scanId) {
      current = runScan(deps, scanId, ac.signal).catch((e: unknown) =>
        deps.logger.error({ scanId, err: e }, 'runScan crashed'),
      )
      await current
      current = null
    }
    if (!stopped) timer = setTimeout(() => void tick(), scanId ? 0 : deps.pollMs)
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
