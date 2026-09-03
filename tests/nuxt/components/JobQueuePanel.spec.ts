import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import JobQueuePanel from '~/components/job/JobQueuePanel.vue'
import type { JobView } from '#shared/types/api'

function jobs(list: JobView[]) {
  registerEndpoint('/api/jobs', () => list)
}

const running: JobView = {
  kind: 'scan',
  status: 'running',
  id: 'sc1',
  siteId: 's1',
  siteName: 'Alpha',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:01.000Z',
  engines: ['nuclei', 'zap-fe'],
}
const queued: JobView = {
  kind: 'discovery',
  status: 'queued',
  id: 'd1',
  siteId: 's2',
  siteName: 'Beta',
  createdAt: '2026-01-01T00:01:00.000Z',
  startedAt: null,
}

afterEach(() => {
  // panel keeps polling; unmounting via GC between tests is fine for jsdom
})

describe('JobQueuePanel', () => {
  it('renders running and queued jobs in order with site names and kind', async () => {
    jobs([running, queued])
    const wrapper = await mountSuspended(JobQueuePanel)
    await flushPromises()

    expect(wrapper.find('[data-testid="job-queue"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('nuclei, zap-fe')
    expect(wrapper.find('[data-testid="job-status-sc1"]').text()).toBe('running')
    expect(wrapper.find('[data-testid="job-status-d1"]').text()).toBe('#1')
    expect(wrapper.text()).toContain('Beta')

    const items = wrapper.findAll('[data-testid^="job-scan-"], [data-testid^="job-discovery-"]')
    expect(items.map((i) => i.attributes('data-testid'))).toEqual([
      'job-scan-sc1',
      'job-discovery-d1',
    ])
  })

  it('numbers queued jobs from #1 when none is running (1-based, not the row index)', async () => {
    jobs([
      { ...queued, id: 'q1', siteName: 'One' },
      { ...queued, id: 'q2', siteName: 'Two' },
    ])
    const wrapper = await mountSuspended(JobQueuePanel)
    await flushPromises()
    expect(wrapper.find('[data-testid="job-status-q1"]').text()).toBe('#1')
    expect(wrapper.find('[data-testid="job-status-q2"]').text()).toBe('#2')
  })

  it('renders nothing when there are no active jobs', async () => {
    jobs([])
    const wrapper = await mountSuspended(JobQueuePanel)
    await flushPromises()
    expect(wrapper.find('[data-testid="job-queue"]').exists()).toBe(false)
  })
})
