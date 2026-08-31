import type { DiscoveryDetail } from '#shared/types/api'

/** Polls `GET /api/discoveries/:id` until the discovery reaches
 * `done`/`failed`. The id is read on every `start()`, so the panel can
 * retarget it at a newly started discovery. */
export function useDiscoveryPolling(discoveryId: () => string, opts: { intervalMs?: number } = {}) {
  return usePolling<DiscoveryDetail>(
    () => $fetch<DiscoveryDetail>(`/api/discoveries/${discoveryId()}`),
    (d) => isTerminalJobStatus(d.status),
    opts,
  )
}
