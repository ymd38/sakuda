import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SiteForm from '~/components/site/SiteForm.vue'
import type { SiteInput } from '#shared/schemas/site'
import type { SitePublic } from '#shared/types/api'

const editSite: SitePublic = {
  id: 'site-1',
  name: 'Example',
  frontBaseUrl: 'https://shop.example.com',
  apiBaseUrl: null,
  nucleiPaths: '',
  openapiUrl: null,
  openapiJson: null,
  zapFeSeedPath: '/',
  excludePaths: '',
  nucleiRateLimit: 50,
  zapApiMaxMinutes: 45,
  zapFeSpiderMaxMinutes: 5,
  nonLocalConfirmed: true,
  headerNames: ['Authorization', 'X-Api-Key'],
  requiresConfirmation: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function submittedPayload(wrapper: {
  emitted: (name: string) => unknown[][] | undefined
}): SiteInput {
  const events = wrapper.emitted('submit')
  if (!events) throw new Error('submit was not emitted')
  return events[0]![0] as SiteInput
}

describe('SiteForm', () => {
  it('renders default values', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    expect(
      (wrapper.find('[data-testid="nuclei-rate-limit"]').element as HTMLInputElement).value,
    ).toBe('50')
    expect(
      (wrapper.find('[data-testid="zap-fe-seed-path"]').element as HTMLInputElement).value,
    ).toBe('/')
  })

  it('reveals the non-local confirmation for a non-local frontBaseUrl and blocks submit until checked', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="front-base-url"]').setValue('https://shop.example.com')

    const confirm = wrapper.find('[data-testid="non-local-confirm"]')
    expect(confirm.exists()).toBe(true)
    const submit = wrapper.find('[data-testid="submit"]')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)

    await confirm.setValue(true)
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('hides the non-local confirmation for a local frontBaseUrl', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="front-base-url"]').setValue('http://localhost:3001')
    expect(wrapper.find('[data-testid="non-local-confirm"]').exists()).toBe(false)
  })

  it('emits SiteInput with empty optional fields as null and numeric fields as numbers', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="name"]').setValue('Example')
    await wrapper.find('[data-testid="front-base-url"]').setValue('http://localhost:3000')
    await wrapper.find('[data-testid="site-form"]').trigger('submit')

    const payload = submittedPayload(wrapper)
    expect(payload.name).toBe('Example')
    expect(payload.apiBaseUrl).toBeNull()
    expect(payload.openapiUrl).toBeNull()
    expect(payload.openapiJson).toBeNull()
    expect(payload.nucleiRateLimit).toBe(50)
    expect(typeof payload.nucleiRateLimit).toBe('number')
    expect(payload.headers).toEqual([])
  })

  it('renders header value inputs as password fields that are never prefilled', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="add-header"]').trigger('click')
    const value = wrapper.find('[data-testid="header-value-0"]')
    expect(value.attributes('type')).toBe('password')
    expect((value.element as HTMLInputElement).value).toBe('')
  })

  it('lists existing header names in edit mode and hides the editor until Replace headers is clicked', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { initial: editSite, submitting: false, errorMessage: null },
    })

    expect(wrapper.text()).toContain('Authorization')
    expect(wrapper.text()).toContain('X-Api-Key')
    expect(wrapper.find('[data-testid="headers-editor"]').exists()).toBe(false)

    await wrapper.find('[data-testid="replace-headers"]').trigger('click')
    expect(wrapper.find('[data-testid="headers-editor"]').exists()).toBe(true)

    await wrapper.find('[data-testid="site-form"]').trigger('submit')
    const payload = submittedPayload(wrapper)
    expect(payload.headers).toEqual([])
  })

  it('renders the errorMessage prop in a text-sale block', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: 'boom' },
    })
    const el = wrapper.find('[data-testid="form-error"]')
    expect(el.exists()).toBe(true)
    expect(el.classes()).toContain('text-sale')
    expect(el.text()).toBe('boom')
  })

  it('disables submit while submitting', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: true, errorMessage: null },
    })
    expect((wrapper.find('[data-testid="submit"]').element as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
