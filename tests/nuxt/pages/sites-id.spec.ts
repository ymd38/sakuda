import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import SiteDetailPage from '~/pages/sites/[id]/index.vue'
import type { SitePublic } from '#shared/types/api'

function siteFixture(overrides: Partial<SitePublic> = {}): SitePublic {
  return {
    id: 'site-1',
    name: 'Example Shop',
    frontBaseUrl: 'https://shop.example.com',
    apiBaseUrl: null,
    nucleiPaths: '',
    openapiUrl: null,
    openapiJson: null,
    zapFeSeedPath: '/',
    discoverySeedPaths: '',
    excludePaths: '',
    nucleiRateLimit: 50,
    zapApiMaxMinutes: 45,
    zapFeSpiderMaxMinutes: 5,
    nonLocalConfirmed: true,
    allowMutatingRequests: false,
    headerNames: [],
    browserStorageNames: [],
    requiresConfirmation: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const ROUTE = '/sites/site-1'

function registerSite(site: SitePublic = siteFixture()) {
  registerEndpoint(`/api/sites/${site.id}`, () => site)
  registerEndpoint(`/api/sites/${site.id}/scans`, () => [])
  registerEndpoint(`/api/sites/${site.id}/history`, () => [])
}

describe('pages/sites/[id] — Start scan engine defaults', () => {
  beforeEach(() => {
    clearNuxtData()
  })

  it('has the nuclei engine checked and enabled on first render', async () => {
    registerSite()
    const wrapper = await mountSuspended(SiteDetailPage, { route: ROUTE })

    const nuclei = wrapper.get('[data-testid="engine-nuclei"]').element as HTMLInputElement
    expect(nuclei.checked).toBe(true)
    expect(nuclei.disabled).toBe(false)
  })

  it('keeps the no-saved-paths hint accurate — base URL only, no zap-fe wording', async () => {
    registerSite(siteFixture({ nucleiPaths: '' }))
    const wrapper = await mountSuspended(SiteDetailPage, { route: ROUTE })

    // The nuclei hint (shown only when no target paths are saved) must describe
    // the real post-#2 behavior — base URL only — and must NOT resurrect the
    // stale "+ zap-fe reached URLs" wording (that in-scan merge was removed).
    const hint = wrapper
      .findAll('p')
      .map((p) => p.text())
      .find((t) => t.includes('No target paths saved'))
    expect(hint).toBeDefined()
    expect(hint).toContain('base URL only')
    expect(hint).not.toMatch(/reached/i)
  })
})
