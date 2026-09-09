import { describe, expect, it } from 'vitest'
import {
  DOM_XSS_PROBE_BUDGET_MINUTES,
  engineTimeBudget,
  recordedTimeBudget,
  timeBudgetEnv,
  ZAP_PASSIVE_MAX_MINUTES,
} from '../engineTimeBudget'

const site = { zapApiMaxMinutes: 45, zapFeSpiderMaxMinutes: 5 }
const env = { nucleiMaxMinutes: 60, engineGraceMinutes: 10 }
const off = { activeScan: false, domXssProbe: false }

describe('engineTimeBudget (#84)', () => {
  it('nuclei: the env cap alone, whatever the active flag', () => {
    expect(engineTimeBudget('nuclei', site, env, off)).toEqual({
      parts: [{ label: 'nuclei (SAKUDA_NUCLEI_MAX_MINUTES)', minutes: 60 }],
      totalMinutes: 60,
    })
    expect(engineTimeBudget('nuclei', site, env, { ...off, activeScan: true }).totalMinutes).toBe(
      60,
    )
  })

  it('zap-api: active cap + passive tail + grace — the timeout zapApi enforced before #84', () => {
    const b = engineTimeBudget('zap-api', site, env, { activeScan: true, domXssProbe: false })
    expect(b.parts.map((p) => p.minutes)).toEqual([45, ZAP_PASSIVE_MAX_MINUTES, 10])
    expect(b.totalMinutes).toBe(45 + 5 + 10)
  })

  it('zap-fe passive: two spider runs + passive tail + grace', () => {
    const b = engineTimeBudget('zap-fe', site, env, off)
    expect(b.parts.map((p) => p.label)).toEqual([
      'spider (traditional + ajax)',
      'passive scan',
      'shutdown grace',
    ])
    expect(b.totalMinutes).toBe(5 * 2 + 5 + 10)
  })

  it('zap-fe active with hash routes adds the active scan and the DOM XSS probe', () => {
    const b = engineTimeBudget('zap-fe', site, env, { activeScan: true, domXssProbe: true })
    expect(b.parts.map((p) => p.label)).toEqual([
      'spider (traditional + ajax)',
      'active scan',
      'DOM XSS probe',
      'passive scan',
      'shutdown grace',
    ])
    expect(b.totalMinutes).toBe(10 + 45 + DOM_XSS_PROBE_BUDGET_MINUTES + 5 + 10)
  })

  it('timeBudgetEnv picks the two env fields', () => {
    expect(
      timeBudgetEnv({
        nuclei: { bin: 'nuclei', templatesDir: '/t', dastTemplatesDir: '/d', maxMinutes: 30 },
        engineGraceMinutes: 7,
      }),
    ).toEqual({ nucleiMaxMinutes: 30, engineGraceMinutes: 7 })
  })
})

describe('recordedTimeBudget', () => {
  it('returns the budget an engine wrote into meta', () => {
    const budget = { parts: [{ label: 'active scan', minutes: 45 }], totalMinutes: 45 }
    expect(recordedTimeBudget({ timeBudget: budget, other: 1 })).toEqual(budget)
  })

  it('returns null for a run that predates the recording or a malformed value', () => {
    expect(recordedTimeBudget({})).toBeNull()
    expect(recordedTimeBudget({ timeBudget: 45 })).toBeNull()
    expect(
      recordedTimeBudget({ timeBudget: { parts: [{ label: 1 }], totalMinutes: 45 } }),
    ).toBeNull()
    expect(recordedTimeBudget({ timeBudget: { parts: [], totalMinutes: '45' } })).toBeNull()
  })
})
