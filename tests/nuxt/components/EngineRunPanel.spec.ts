import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EngineRunPanel from '~/components/scan/EngineRunPanel.vue'
import { engineRunFixture, findingFixture } from '../helpers/fixtures'

describe('EngineRunPanel', () => {
  it('renders a count cell for every severity level, including low/info as counts-only', async () => {
    const run = engineRunFixture({
      counts: { critical: 1, high: 2, medium: 3, low: 4, info: 5 },
    })
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings: [] } })

    expect(wrapper.find('[data-testid="severity-count-critical"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="severity-count-low"]').text()).toContain('4')
    expect(wrapper.find('[data-testid="severity-count-low"]').text()).toContain('counts only')
    expect(wrapper.find('[data-testid="severity-count-info"]').text()).toContain('counts only')
    expect(wrapper.find('[data-testid="severity-count-high"]').text()).not.toContain('counts only')
  })

  it('shows the engine label and a status pill', async () => {
    const run = engineRunFixture({ engine: 'zap-fe', status: 'failed' })
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings: [] } })

    expect(wrapper.text()).toContain('ZAP Frontend (baseline)')
    const pill = wrapper.find('[data-testid="engine-status-pill"]')
    expect(pill.text()).toBe('failed')
    expect(pill.classes()).toContain('text-sale')
  })

  it('renders each warning as its own row', async () => {
    const run = engineRunFixture({ warnings: ['auth failed for 3 requests', 'rate limited'] })
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings: [] } })

    const rows = wrapper.findAll('[data-testid="engine-warning"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toBe('auth failed for 3 requests')
    expect(rows[0]?.classes()).toContain('border-sale')
  })

  it('renders the run error in a <pre> block', async () => {
    const run = engineRunFixture({ status: 'failed', error: 'process exited with code 1' })
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings: [] } })

    const pre = wrapper.find('[data-testid="engine-error"]')
    expect(pre.element.tagName).toBe('PRE')
    expect(pre.text()).toBe('process exited with code 1')
  })

  it('builds metadata rows from primitives, a capped string array, and a nested object', async () => {
    const manyUrls = Array.from({ length: 65 }, (_, i) => `https://example.com/path-${i}`)
    const run = engineRunFixture({
      meta: {
        rateLimit: 50,
        excludedUrls: manyUrls,
        stats: { templates: '120', requests: '4500' },
      },
    })
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings: [] } })
    const table = wrapper.find('[data-testid="engine-meta-table"]')

    expect(table.text()).toContain('rateLimit')
    expect(table.text()).toContain('50')
    expect(table.text()).toContain('https://example.com/path-0')
    expect(table.text()).toContain('https://example.com/path-59')
    expect(table.text()).not.toContain('https://example.com/path-60')
    expect(table.text()).toContain('… 5 more')
    expect(table.text()).toContain('templates')
    expect(table.text()).toContain('120')
    expect(table.text()).toContain('requests')
    expect(table.text()).toContain('4500')
  })

  it('filters the findings list down to this run’s engine', async () => {
    const run = engineRunFixture({ engine: 'nuclei' })
    const findings = [
      findingFixture({ id: 'f-nuclei', engine: 'nuclei', name: 'Nuclei finding' }),
      findingFixture({ id: 'f-zap', engine: 'zap-fe', name: 'ZAP finding' }),
    ]
    const wrapper = await mountSuspended(EngineRunPanel, { props: { run, findings } })

    expect(wrapper.text()).toContain('Nuclei finding')
    expect(wrapper.text()).not.toContain('ZAP finding')
  })
})
