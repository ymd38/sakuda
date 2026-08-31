import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import DiscoveryPanel from '~/components/site/DiscoveryPanel.vue'
import { buttonElement } from '../helpers/dom'
import type {
  AddTargetsResult,
  DiscoveryDetail,
  DiscoverySummary,
  SitePublic,
} from '#shared/types/api'

function siteFixture(overrides: Partial<SitePublic> = {}): SitePublic {
  return {
    id: 'site-1',
    name: 'Example',
    frontBaseUrl: 'http://localhost:4001',
    apiBaseUrl: null,
    nucleiPaths: '/\n/already-saved',
    openapiUrl: null,
    openapiJson: null,
    zapFeSeedPath: '/',
    discoverySeedPaths: '',
    excludePaths: '',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: true,
    headerNames: [],
    browserStorageNames: [],
    requiresConfirmation: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function summaryFixture(overrides: Partial<DiscoverySummary> = {}): DiscoverySummary {
  return {
    id: 'disc-1',
    siteId: 'site-1',
    status: 'done',
    createdAt: '2026-01-02T10:00:00.000Z',
    startedAt: '2026-01-02T10:00:01.000Z',
    finishedAt: '2026-01-02T10:03:00.000Z',
    error: null,
    urlCount: 3,
    ...overrides,
  }
}

function detailFixture(overrides: Partial<DiscoveryDetail> = {}): DiscoveryDetail {
  return {
    ...summaryFixture(),
    urls: [
      { url: 'http://localhost:4001/', method: 'GET', statusCode: 200, source: 'spider' },
      {
        url: 'http://localhost:4001/rest/products/search?q=',
        method: 'GET',
        statusCode: 200,
        source: 'ajax',
      },
      {
        url: 'http://localhost:4001/already-saved',
        method: 'GET',
        statusCode: 200,
        source: 'spider',
      },
    ],
    meta: { nodeCount: 12, dropped: { asset: 4, noise: 2, invalid: 0 } },
    warnings: ['1 request(s) got 401/403 — headers may be missing or expired'],
    ...overrides,
  }
}

const unregisters: Array<() => void> = []
function endpoint(...args: Parameters<typeof registerEndpoint>) {
  unregisters.push(registerEndpoint(...args))
}

let activeWrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

async function mountPanel(site = siteFixture()) {
  activeWrapper = await mountSuspended(DiscoveryPanel, { props: { site } })
  await flushPromises()
  await flushPromises()
  return activeWrapper
}

describe('DiscoveryPanel', () => {
  beforeEach(() => {
    clearNuxtData()
  })

  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = undefined
    for (const u of unregisters.splice(0)) u()
  })

  it('shows the empty state and an enabled Discover button when nothing was discovered yet', async () => {
    endpoint('/api/sites/site-1/discoveries', () => [])
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('No discovery yet')
    expect(buttonElement(wrapper, '[data-testid="start-discovery"]').disabled).toBe(false)
    expect(wrapper.find('[data-testid="discovered-urls"]').exists()).toBe(false)
    // nothing to save yet
    expect(buttonElement(wrapper, '[data-testid="save-targets"]').disabled).toBe(true)
  })

  it('lists the latest discovery with unsaved URLs pre-selected and saved ones marked', async () => {
    endpoint('/api/sites/site-1/discoveries', () => [summaryFixture()])
    endpoint('/api/discoveries/disc-1', () => detailFixture())
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-testid="discovery-status"]').text()).toContain('done')
    expect(wrapper.find('[data-testid="discovery-warning"]').text()).toContain('401/403')
    expect(wrapper.text()).toContain('12 nodes crawled')
    expect(wrapper.text()).toContain('asset 4, noise 2')

    const rows = wrapper.findAll('[data-testid="discovered-url"]')
    expect(rows).toHaveLength(3)
    // "/" and "/already-saved" are in nucleiPaths → marked saved, disabled, checked
    expect(rows[0]?.text()).toContain('saved')
    const checkboxes = wrapper.findAll('[data-testid="discovered-url-checkbox"]')
    const savedBox = checkboxes[0]?.element
    const newBox = checkboxes[1]?.element
    if (!(savedBox instanceof HTMLInputElement) || !(newBox instanceof HTMLInputElement))
      throw new Error('expected checkbox inputs')
    expect(savedBox.disabled).toBe(true)
    expect(savedBox.checked).toBe(true)
    expect(newBox.disabled).toBe(false)
    expect(newBox.checked).toBe(true)
    expect(wrapper.text()).toContain('1 selected')
    expect(buttonElement(wrapper, '[data-testid="save-targets"]').textContent).toContain(
      'Save 1 to targets',
    )
  })

  it('posts the selected lines plus manual lines, then emits the updated site', async () => {
    endpoint('/api/sites/site-1/discoveries', () => [summaryFixture()])
    endpoint('/api/discoveries/disc-1', () => detailFixture())
    let posted: unknown
    const updated = siteFixture({
      nucleiPaths: '/\n/already-saved\n/rest/products/search?q=\napi:/health\n',
    })
    endpoint('/api/sites/site-1/targets', {
      method: 'POST',
      handler: async (event) => {
        posted = await readBody(event)
        const result: AddTargetsResult = {
          site: updated,
          added: ['/rest/products/search?q=', '/health'],
          skipped: [],
        }
        return result
      },
    })
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="manual-target-lines"]').setValue('/health\n\n')
    expect(buttonElement(wrapper, '[data-testid="save-targets"]').textContent).toContain(
      'Save 2 to targets',
    )
    await wrapper.find('[data-testid="save-targets"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(posted).toEqual({ lines: ['/rest/products/search?q=', '/health'] })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(updated)
    expect(wrapper.find('[data-testid="save-message"]').text()).toContain(
      'Saved 2 new target paths',
    )
    const manual = wrapper.find('[data-testid="manual-target-lines"]').element
    if (!(manual instanceof HTMLTextAreaElement)) throw new Error('expected a <textarea>')
    expect(manual.value).toBe('')
  })

  it('starts a discovery and disables the button while it is running', async () => {
    endpoint('/api/sites/site-1/discoveries', () => [])
    let posts = 0
    endpoint('/api/sites/site-1/discoveries', {
      method: 'POST',
      handler: () => {
        posts++
        return summaryFixture({ id: 'disc-9', status: 'queued', urlCount: 0, finishedAt: null })
      },
    })
    endpoint('/api/discoveries/disc-9', () =>
      detailFixture({ id: 'disc-9', status: 'running', urls: [], warnings: [], meta: {} }),
    )
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="start-discovery"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(posts).toBe(1)
    expect(buttonElement(wrapper, '[data-testid="start-discovery"]').disabled).toBe(true)
    expect(wrapper.find('[data-testid="start-discovery"]').text()).toContain('Discovering')
    expect(wrapper.find('[data-testid="discovery-status"]').text()).toContain('running')
  })

  it('shows the API error when starting a discovery is rejected', async () => {
    endpoint('/api/sites/site-1/discoveries', () => [])
    endpoint('/api/sites/site-1/discoveries', {
      method: 'POST',
      handler: () => {
        throw createError({ statusCode: 409, statusMessage: 'site has an active scan' })
      },
    })
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="start-discovery"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="discovery-error"]').text()).toContain('active scan')
  })
})
