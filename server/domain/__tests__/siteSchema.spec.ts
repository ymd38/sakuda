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
      discoverySeedPaths: '',
      excludePaths: '',
      nucleiRateLimit: 50,
      zapApiMaxMinutes: 45,
      zapFeSpiderMaxMinutes: 5,
      nonLocalConfirmed: false,
      allowMutatingRequests: false,
      nucleiEnabledRiskTags: [],
    })
  })

  it('defaults nucleiEnabledRiskTags to [] and rejects an unknown risk tag', () => {
    const ok = SiteInputSchema.safeParse({ name: 's', frontBaseUrl: 'http://localhost:3000' })
    expect(ok.success && ok.data.nucleiEnabledRiskTags).toEqual([])
    const bad = SiteInputSchema.safeParse({
      name: 's',
      frontBaseUrl: 'http://localhost:3000',
      nucleiEnabledRiskTags: ['fuzz', 'nope'],
    })
    expect(bad.success).toBe(false)
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
      allowMutatingRequests: false,
      nucleiEnabledRiskTags: [],
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

  it('defaults discoverySeedPaths to empty and rejects lines that are not paths', () => {
    const ok = SiteInputSchema.safeParse({ ...minimal, discoverySeedPaths: '/\n/#/basket\n# c' })
    expect(ok.success).toBe(true)
    expect(
      SiteInputSchema.safeParse(minimal).success &&
        SiteInputSchema.parse(minimal).discoverySeedPaths,
    ).toBe('')
    const issues = issuesFor({ ...minimal, discoverySeedPaths: '/ok\nhttp://x.example/' })
    expect(issues.map((i) => i.path.join('.'))).toEqual(['discoverySeedPaths'])
    expect(issues[0]?.message).toContain('line 2')
  })

  it('accepts browserStorage items and enforces cookie naming rules', () => {
    expect(
      SiteInputSchema.safeParse({
        ...minimal,
        browserStorage: [
          { kind: 'localStorage', name: 'token', value: 'abc' },
          { kind: 'cookie', name: 'token', value: 'abc' },
        ],
      }).success,
    ).toBe(true)
    const issues = issuesFor({
      ...minimal,
      browserStorage: [{ kind: 'cookie', name: 'bad name', value: 'x;y' }],
    })
    expect(issues.map((i) => i.path.join('.'))).toEqual([
      'browserStorage.0.name',
      'browserStorage.0.value',
    ])
    expect(
      issuesFor({ ...minimal, browserStorage: [{ kind: 'indexedDB', name: 'a', value: 'b' }] }),
    ).not.toHaveLength(0)
  })
})
