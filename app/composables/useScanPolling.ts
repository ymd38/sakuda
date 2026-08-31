import type { ScanDetail } from '#shared/types/api'

/** Polls `GET /api/scans/:id` until the scan reaches `done`/`failed`. */
export function useScanPolling(scanId: string, opts: { intervalMs?: number } = {}) {
  return usePolling<ScanDetail>(
    () => $fetch<ScanDetail>(`/api/scans/${scanId}`),
    (scan) => isTerminalJobStatus(scan.status),
    opts,
  )
}
