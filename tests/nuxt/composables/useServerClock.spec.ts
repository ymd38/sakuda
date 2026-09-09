import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useServerClock } from '~/composables/useServerClock'

function mountClock(serverNow: ReturnType<typeof ref<string | null>>) {
  let clock!: ReturnType<typeof useServerClock>
  const wrapper = mount(
    defineComponent({
      setup() {
        clock = useServerClock(serverNow)
        return () => h('div')
      },
    }),
  )
  return { wrapper, clock }
}

describe('useServerClock (#84)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z')) // skewed browser clock
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('anchors now to the server time and advances it with the local tick', async () => {
    const serverNow = ref<string | null>('2026-01-01T00:10:00.000Z')
    const { clock, wrapper } = mountClock(serverNow)
    expect(clock.now.value.toISOString()).toBe('2026-01-01T00:10:00.000Z')

    await vi.advanceTimersByTimeAsync(3000)
    expect(clock.now.value.toISOString()).toBe('2026-01-01T00:10:03.000Z')
    wrapper.unmount()
  })

  it('re-anchors on every new server time', async () => {
    const serverNow = ref<string | null>('2026-01-01T00:10:00.000Z')
    const { clock, wrapper } = mountClock(serverNow)
    await vi.advanceTimersByTimeAsync(5000)

    serverNow.value = '2026-01-01T00:20:00.000Z'
    await nextTick()
    expect(clock.now.value.toISOString()).toBe('2026-01-01T00:20:00.000Z')
    wrapper.unmount()
  })

  it('falls back to the local clock while no server time is known', () => {
    const serverNow = ref<string | null>(null)
    const { clock, wrapper } = mountClock(serverNow)
    expect(clock.now.value.toISOString()).toBe('2026-01-01T09:00:00.000Z')
    wrapper.unmount()
  })
})
