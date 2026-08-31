const DEFAULT_INTERVAL_MS = 2500

/** Polls `fetchOnce()` on a setTimeout chain until `isTerminal(result)` or
 * the request fails. `stopped` guards both the post-await state update and
 * the reschedule, so a `stop()` called while a request is in flight
 * (component unmount, navigating away) is honored even after that request
 * resolves. `fetchOnce` is re-invoked on every tick, so a caller can
 * retarget the poll (e.g. at a newly started job) and simply call `start()`
 * again. */
export function usePolling<T>(
  fetchOnce: () => Promise<T>,
  isTerminal: (result: T) => boolean,
  opts: { intervalMs?: number } = {},
) {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  // as: Vue's `ref<T>()` unwraps nested refs in its return type (UnwrapRef<T>),
  // which a bare generic T cannot be assigned back to; the cast restores the
  // caller's T. Every write below is a full T from fetchOnce(), never a ref.
  const state = ref<T | null>(null) as Ref<T | null>
  const error = ref<string | null>(null)
  const done = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  // Each start() begins a new run; a fetch still in flight from an older run
  // must not touch state or schedule a timer once a newer run has begun
  // (start() flips `stopped` back to false, so that flag alone can't tell).
  let runToken = 0

  function stop() {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function tick(token: number) {
    let result: T
    try {
      result = await fetchOnce()
    } catch (err) {
      if (stopped || token !== runToken) return
      error.value = toApiErrorMessage(err)
      done.value = true
      stop()
      return
    }

    if (stopped || token !== runToken) return
    state.value = result
    if (isTerminal(result)) {
      done.value = true
      stop()
      return
    }
    timer = setTimeout(() => void tick(token), intervalMs)
  }

  function start() {
    stop() // clear any existing chain before re-entering (no duplicate polling)
    runToken++
    stopped = false
    done.value = false
    error.value = null
    void tick(runToken)
  }

  // Calling onUnmounted outside a component (e.g. from a plain unit test)
  // triggers a Vue warning — only register it when there is an instance.
  if (getCurrentInstance()) {
    onUnmounted(stop)
  }

  return { state, error, done, start, stop }
}

export function isTerminalJobStatus(status: string): boolean {
  return status === 'done' || status === 'failed'
}
