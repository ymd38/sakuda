import { describe, expect, it } from 'vitest'
import { buildReplacerConf } from '../replacer'

describe('buildReplacerConf', () => {
  it('emits exactly 6 lines per header (12 lines for two headers), trailing newline', () => {
    const conf = buildReplacerConf([
      { name: 'X-Api-Key', value: 'abc' },
      { name: 'Authorization', value: 'Bearer xyz' },
    ])

    const lines = conf.split('\n')
    expect(lines).toHaveLength(13) // 12 content lines + trailing empty string from the final \n
    expect(lines[12]).toBe('')
    expect(conf.endsWith('\n')).toBe(true)
    expect(conf).toBe(
      [
        'replacer.full_list(0).description=sakuda header X-Api-Key',
        'replacer.full_list(0).enabled=true',
        'replacer.full_list(0).matchtype=REQ_HEADER',
        'replacer.full_list(0).matchstr=X-Api-Key',
        'replacer.full_list(0).regex=false',
        'replacer.full_list(0).replacement=abc',
        'replacer.full_list(1).description=sakuda header Authorization',
        'replacer.full_list(1).enabled=true',
        'replacer.full_list(1).matchtype=REQ_HEADER',
        'replacer.full_list(1).matchstr=Authorization',
        'replacer.full_list(1).regex=false',
        'replacer.full_list(1).replacement=Bearer xyz',
        '',
      ].join('\n'),
    )
  })

  it('doubles a backslash in the replacement value', () => {
    const conf = buildReplacerConf([{ name: 'X-Token', value: 'a\\b' }])
    expect(conf).toContain('replacer.full_list(0).replacement=a\\\\b')
  })

  it('returns an empty string for an empty header list', () => {
    expect(buildReplacerConf([])).toBe('')
  })
})
