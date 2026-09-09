import type { Ref } from 'vue'

/**
 * A "now" anchored to the server's clock: the last polled `serverNow`,
 * advanced locally by the time since it arrived, re-anchored on every poll.
 * Elapsed times derived from it stay consistent with the server-side
 * `startedAt` stamps even when the browser clock is skewed. Falls back to
 * the local clock while no server time is known. Ticks once a second so a
 * running duration keeps moving between polls.
 */
export function useServerClock(serverNow: Ref<string | null | undefined>) {
  const receivedAt = ref(Date.now())
  watch(serverNow, () => {
    receivedAt.value = Date.now()
  })

  const tick = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      tick.value = Date.now()
    }, 1000)
  })
  onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer)
  })

  const now = computed(() => {
    const server = serverNow.value ? new Date(serverNow.value).getTime() : NaN
    const base = Number.isNaN(server) ? receivedAt.value : server
    return new Date(base + (tick.value - receivedAt.value))
  })
  return { now }
}
