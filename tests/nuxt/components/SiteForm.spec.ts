import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SiteForm from '~/components/site/SiteForm.vue'
import { SiteInputSchema, type SiteInput } from '#shared/schemas/site'
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

/** Structural shape of what we need from a `mountSuspended` result — narrow
 * on purpose so this file never needs `VueWrapper<any>`. */
interface ElementWrapper {
  find: (selector: string) => { element: Element }
}

interface EmitsSubmit {
  emitted: (name: string) => unknown[][] | undefined
}

function inputElement(wrapper: ElementWrapper, selector: string): HTMLInputElement {
  const el = wrapper.find(selector).element
  if (!(el instanceof HTMLInputElement)) throw new Error(`expected an <input> at ${selector}`)
  return el
}

function buttonElement(wrapper: ElementWrapper, selector: string): HTMLButtonElement {
  const el = wrapper.find(selector).element
  if (!(el instanceof HTMLButtonElement)) throw new Error(`expected a <button> at ${selector}`)
  return el
}

/** Validates (rather than casts) the emitted payload against the real
 * schema, so a shape drift in SiteForm fails the test instead of silently
 * passing through an unchecked `as SiteInput`. */
function emittedSubmit(wrapper: EmitsSubmit): SiteInput {
  const events = wrapper.emitted('submit')
  const first = events?.[0]?.[0]
  if (first === undefined) throw new Error('submit was not emitted')
  return SiteInputSchema.parse(first)
}

describe('SiteForm', () => {
  it('renders default values', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    expect(inputElement(wrapper, '[data-testid="nuclei-rate-limit"]').value).toBe('50')
    expect(inputElement(wrapper, '[data-testid="zap-fe-seed-path"]').value).toBe('/')
  })

  it('shows no confirmation checkbox on a fresh, blank form', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    expect(wrapper.find('[data-testid="non-local-confirm"]').exists()).toBe(false)
  })

  it('reveals the non-local confirmation for a non-local frontBaseUrl and blocks submit until checked', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="front-base-url"]').setValue('https://shop.example.com')

    const confirm = wrapper.find('[data-testid="non-local-confirm"]')
    expect(confirm.exists()).toBe(true)
    const submit = buttonElement(wrapper, '[data-testid="submit"]')
    expect(submit.disabled).toBe(true)

    await confirm.setValue(true)
    expect(submit.disabled).toBe(false)
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

    const payload = emittedSubmit(wrapper)
    expect(payload.name).toBe('Example')
    expect(payload.apiBaseUrl).toBeNull()
    expect(payload.openapiUrl).toBeNull()
    expect(payload.openapiJson).toBeNull()
    expect(payload.nucleiRateLimit).toBe(50)
    expect(typeof payload.nucleiRateLimit).toBe('number')
    expect(payload.headers).toEqual([])
  })

  it('falls back to the schema defaults when a numeric field is cleared', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="name"]').setValue('Example')
    await wrapper.find('[data-testid="front-base-url"]').setValue('http://localhost:3000')
    await wrapper.find('[data-testid="nuclei-rate-limit"]').setValue('')
    await wrapper.find('[data-testid="zap-api-max-minutes"]').setValue('')
    await wrapper.find('[data-testid="zap-fe-spider-max-minutes"]').setValue('')
    await wrapper.find('[data-testid="site-form"]').trigger('submit')

    const payload = emittedSubmit(wrapper)
    expect(payload.nucleiRateLimit).toBe(50)
    expect(payload.zapApiMaxMinutes).toBe(45)
    expect(payload.zapFeSpiderMaxMinutes).toBe(5)
  })

  it('renders header value inputs as password fields that are never prefilled', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="add-header"]').trigger('click')
    const value = wrapper.find('[data-testid="header-value-0"]')
    expect(value.attributes('type')).toBe('password')
    expect(inputElement(wrapper, '[data-testid="header-value-0"]').value).toBe('')
  })

  it('drops a header row that has a name but no value', async () => {
    const wrapper = await mountSuspended(SiteForm, {
      props: { submitting: false, errorMessage: null },
    })
    await wrapper.find('[data-testid="name"]').setValue('Example')
    await wrapper.find('[data-testid="front-base-url"]').setValue('http://localhost:3000')
    await wrapper.find('[data-testid="add-header"]').trigger('click')
    await wrapper.find('[data-testid="header-name-0"]').setValue('Authorization')
    await wrapper.find('[data-testid="site-form"]').trigger('submit')

    const payload = emittedSubmit(wrapper)
    expect(payload.headers).toEqual([])
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
    const payload = emittedSubmit(wrapper)
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
    expect(buttonElement(wrapper, '[data-testid="submit"]').disabled).toBe(true)
  })
})
