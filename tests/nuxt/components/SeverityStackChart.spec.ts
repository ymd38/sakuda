import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SeverityStackChart from '~/components/chart/SeverityStackChart.vue'
import ChartCanvas from '~/components/chart/ChartCanvas.vue'
import { historyPointFixture } from '../helpers/fixtures'

vi.mock('chart.js/auto', () => ({
  default: class {
    data: unknown
    update = vi.fn()
    destroy = vi.fn()
    constructor(_canvas: unknown, config: { data: unknown }) {
      this.data = config.data
    }
  },
}))

describe('SeverityStackChart', () => {
  it('renders the stacked bar chart once there are 2+ history points', async () => {
    const history = [
      historyPointFixture({ scanId: 'scan-1' }),
      historyPointFixture({ scanId: 'scan-2' }),
    ]
    const wrapper = await mountSuspended(SeverityStackChart, { props: { history } })

    const canvas = wrapper.findComponent(ChartCanvas)
    expect(canvas.exists()).toBe(true)
    expect(canvas.props('config').type).toBe('bar')
  })

  it('shows the not-enough-data message for a single history point', async () => {
    const wrapper = await mountSuspended(SeverityStackChart, {
      props: { history: [historyPointFixture()] },
    })

    expect(wrapper.findComponent(ChartCanvas).exists()).toBe(false)
    expect(wrapper.text()).toContain('Not enough data — charts appear after 2 finished scans')
  })
})
