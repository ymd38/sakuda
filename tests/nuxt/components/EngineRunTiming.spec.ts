import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EngineRunTiming from '~/components/scan/EngineRunTiming.vue'
import { engineRunFixture } from '../helpers/fixtures'

const SERVER_NOW = '2026-01-01T00:03:30.000Z'

describe('EngineRunTiming (#84)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z')) // browser clock, deliberately skewed
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function mount(run: Parameters<typeof engineRunFixture>[0] | null) {
    return mountSuspended(EngineRunTiming, {
      props: {
        engine: 'zap-fe',
        run: run === null ? null : engineRunFixture({ engine: 'zap-fe', ...run }),
        serverNow: SERVER_NOW,
      },
    })
  }

  it('pending: label and a muted pill, no elapsed time and no limit', async () => {
    const wrapper = await mount(null)
    expect(wrapper.text()).toContain('ZAP Frontend (baseline)')
    const pill = wrapper.find('[data-testid="engine-status-pill"]')
    expect(pill.text()).toBe('pending')
    expect(pill.classes()).toContain('text-mute')
    expect(wrapper.find('[data-testid="engine-elapsed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="engine-limit"]').exists()).toBe(false)
  })

  it('running: elapsed time is measured against the server clock and keeps ticking', async () => {
    const wrapper = await mount({
      status: 'running',
      startedAt: '2026-01-01T00:01:00.000Z',
      finishedAt: null,
    })
    expect(wrapper.find('[data-testid="engine-status-pill"]').classes()).toContain('text-info')
    // server now (00:03:30) − startedAt (00:01:00), not the skewed browser clock
    expect(wrapper.find('[data-testid="engine-elapsed"]').text()).toBe('Elapsed 2m 30s')

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.find('[data-testid="engine-elapsed"]').text()).toBe('Elapsed 2m 32s')
  })

  it('skipped: muted pill reading "skipped"', async () => {
    const wrapper = await mount({
      status: 'skipped',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:00.000Z',
    })
    const pill = wrapper.find('[data-testid="engine-status-pill"]')
    expect(pill.text()).toBe('skipped')
    expect(pill.classes()).toContain('text-mute')
  })

  it('done: total duration, the limit, and no stopped-at-limit mark', async () => {
    const wrapper = await mount({
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:41:07.000Z',
      limits: {
        parts: [
          { label: 'spider (traditional + ajax)', minutes: 10 },
          { label: 'active scan', minutes: 45 },
        ],
        totalMinutes: 55,
        estimated: false,
      },
    })
    expect(wrapper.find('[data-testid="engine-status-pill"]').classes()).toContain('text-success')
    expect(wrapper.find('[data-testid="engine-elapsed"]').text()).toBe('Took 41m 07s')
    const limit = wrapper.find('[data-testid="engine-limit"]')
    expect(limit.text()).toBe('Limit 55 min')
    expect(limit.attributes('title')).toContain('active scan: 45 min')
    expect(wrapper.find('[data-testid="engine-stopped-at-limit"]').exists()).toBe(false)
  })

  it('failed: red pill, duration still shown', async () => {
    const wrapper = await mount({
      status: 'failed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:20.000Z',
    })
    expect(wrapper.find('[data-testid="engine-status-pill"]').classes()).toContain('text-sale')
    expect(wrapper.find('[data-testid="engine-elapsed"]').text()).toBe('Took 0m 20s')
  })

  it('marks a run the budget cut off, and flags an estimated limit', async () => {
    const wrapper = await mount({
      status: 'done',
      meta: { timedOut: true },
      limits: { parts: [{ label: 'nuclei', minutes: 60 }], totalMinutes: 60, estimated: true },
    })
    expect(wrapper.find('[data-testid="engine-stopped-at-limit"]').text()).toBe('stopped at limit')
    expect(wrapper.find('[data-testid="engine-limit"]').text()).toBe('Limit 60 min (estimated)')
  })
})
