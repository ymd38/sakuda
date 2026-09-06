import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import SiteEditPage from '~/pages/sites/[id]/edit.vue'
import type { SitePublic } from '#shared/types/api'

const site: SitePublic = {
  id: 'site-1',
  name: 'Example Shop',
  frontBaseUrl: 'https://shop.example.com',
  apiBaseUrl: null,
  nucleiPaths: '',
  openapiUrl: null,
  openapiJson: null,
  zapFeSeedPath: '/',
  discoverySeedPaths: '',
  crawlScopePaths: '',
  excludePaths: '',
  nucleiRateLimit: 50,
  zapApiMaxMinutes: 45,
  zapFeSpiderMaxMinutes: 5,
  nonLocalConfirmed: true,
  allowMutatingRequests: false,
  nucleiEnabledRiskTags: [],
  headerNames: [],
  browserStorageNames: [],
  requiresConfirmation: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('pages/sites/[id]/edit', () => {
  beforeEach(() => {
    clearNuxtData()
    registerEndpoint(`/api/sites/${site.id}`, () => site)
  })

  it('offers a Cancel link back to the site page, beside Save', async () => {
    const wrapper = await mountSuspended(SiteEditPage, { route: `/sites/${site.id}/edit` })
    const cancel = wrapper.find('[data-testid="cancel"]')
    expect(cancel.exists()).toBe(true)
    expect(cancel.attributes('href')).toBe(`/sites/${site.id}`)
    expect(wrapper.find('[data-testid="submit"]').text()).toBe('Save changes')
  })
})
