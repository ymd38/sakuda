import type { ScanDetail } from '#shared/types/api'

const DEFAULT_INTERVAL_MS = 2500

/** Polls `GET /api/scans/:id` on a setTimeout chain until the scan reaches a
 * terminal status (`done`/`failed`) or the request fails. `stopped` guards
 * both the post-await state update and the reschedule, so a `stop()` called
 * while a request is in flight (component unmount, navigating away) is
 * honored even after that request resolves. */
export function useScanPolling(scanId: string, opts: { intervalMs?: number } = {}) {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const state = ref<ScanDetail | null>(null)
  const error = ref<string | null>(null)
  const done = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function stop() {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function tick() {
    let result: ScanDetail
    try {
      result = await $fetch<ScanDetail>(`/api/scans/${scanId}`)
    } catch (err) {
      if (stopped) return
      error.value = toApiErrorMessage(err)
      done.value = true
      stop()
      return
    }

    if (stopped) return
    state.value = result
    if (result.status === 'done' || result.status === 'failed') {
      done.value = true
      stop()
      return
    }
    timer = setTimeout(() => void tick(), intervalMs)
  }

  function start() {
    stop() // clear any existing chain before re-entering (no duplicate polling)
    stopped = false
    done.value = false
    error.value = null
    void tick()
  }

  // Calling onUnmounted outside a component (e.g. from a plain unit test)
  // triggers a Vue warning — only register it when there is an instance.
  if (getCurrentInstance()) {
    onUnmounted(stop)
  }

  return { state, error, done, start, stop }
}
