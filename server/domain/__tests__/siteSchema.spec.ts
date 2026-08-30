import { describe, expect, it } from 'vitest'
import { SiteInputSchema } from '#shared/schemas/site'

const minimal = { name: 'Site', frontBaseUrl: 'http://localhost:3000' }

function issuesFor(input: unknown) {
  const result = SiteInputSchema.safeParse(input)
  if (result.success) return []
  return result.error.issues
}

describe('SiteInputSchema', () => {
  it('applies defaults for a minimal valid input', () => {
    const result = SiteInputSchema.safeParse(minimal)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({
      apiBaseUrl: null,
      nucleiPaths: '',
      openapiUrl: null,
      openapiJson: null,
      zapFeSeedPath: '/',
      excludePaths: '',
      nucleiRateLimit: 50,
      zapApiMaxMinutes: 45,
      zapFeSpiderMaxMinutes: 5,
      nonLocalConfirmed: false,
    })
  })

  it('maps empty string to null for optional URLs', () => {
    const result = SiteInputSchema.safeParse({ ...minimal, apiBaseUrl: '', openapiUrl: '' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.apiBaseUrl).toBeNull()
    expect(result.data.openapiUrl).toBeNull()
  })

  it('strips trailing slash from base URLs', () => {
    const result = SiteInputSchema.safeParse({
      ...minimal,
      frontBaseUrl: 'http://localhost:3000/',
      apiBaseUrl: 'http://localhost:8080/',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.frontBaseUrl).toBe('http://localhost:3000')
    expect(result.data.apiBaseUrl).toBe('http://localhost:8080')
  })

  it('requires apiBaseUrl when nucleiPaths has an "api:" line', () => {
    const issues = issuesFor({ ...minimal, nucleiPaths: 'api:/v1/users' })
    expect(issues.some((i) => i.path.join('.') === 'apiBaseUrl')).toBe(true)
  })

  it('rejects both openapiUrl and openapiJson set', () => {
    const issues = issuesFor({
      ...minimal,
      openapiUrl: 'http://localhost:3000/openapi.json',
      openapiJson: '{"a":1}',
    })
    expect(issues.some((i) => i.path.join('.') === 'openapiJson')).toBe(true)
  })

  it('rejects invalid openapiJson', () => {
    const issues = issuesFor({ ...minimal, openapiJson: 'not json' })
    expect(issues.some((i) => i.path.join('.') === 'openapiJson')).toBe(true)
  })

  it('requires nonLocalConfirmed when frontBaseUrl is non-local', () => {
    const issues = issuesFor({ ...minimal, frontBaseUrl: 'https://app.example.com' })
    const issue = issues.find((i) => i.path.join('.') === 'nonLocalConfirmed')
    expect(issue?.message).toContain('nonLocalConfirmed')
  })

  it('requires nonLocalConfirmed when only openapiUrl is non-local (I2)', () => {
    const issues = issuesFor({
      ...minimal,
      openapiUrl: 'https://internal.corp/openapi.json',
    })
    const issue = issues.find((i) => i.path.join('.') === 'nonLocalConfirmed')
    expect(issue?.message).toContain('nonLocalConfirmed')
  })

  it('accepts a non-local frontBaseUrl when nonLocalConfirmed is true', () => {
    const result = SiteInputSchema.safeParse({
      ...minimal,
      frontBaseUrl: 'https://app.example.com',
      nonLocalConfirmed: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a bad nucleiPaths line', () => {
    const issues = issuesFor({ ...minimal, nucleiPaths: 'not-a-path' })
    expect(issues.some((i) => i.path.join('.') === 'nucleiPaths')).toBe(true)
  })

  it('validates headers', () => {
    const issues = issuesFor({ ...minimal, headers: [{ name: 'X:Y', value: 'a' }] })
    expect(issues.some((i) => i.path[0] === 'headers')).toBe(true)
  })

  it('accepts valid headers', () => {
    const result = SiteInputSchema.safeParse({
      ...minimal,
      headers: [{ name: 'Cookie', value: 'a=b' }],
    })
    expect(result.success).toBe(true)
  })

  it('requires zapFeSeedPath to start with "/"', () => {
    const issues = issuesFor({ ...minimal, zapFeSeedPath: 'no-slash' })
    expect(issues.some((i) => i.path.join('.') === 'zapFeSeedPath')).toBe(true)
  })
})
