import { describe, expect, it } from 'vitest'
import { buildFirefoxPrefsConfig } from '../firefoxPrefs'

describe('buildFirefoxPrefsConfig', () => {
  it('registers the alias host as a secure context via the Selenium add-on Firefox pref (config keys in list order)', () => {
    expect(buildFirefoxPrefsConfig('host.docker.internal')).toEqual({
      'selenium.firefoxPrefs.pref(0).name': 'dom.securecontext.allowlist',
      'selenium.firefoxPrefs.pref(0).value': 'host.docker.internal',
      'selenium.firefoxPrefs.pref(0).enabled': 'true',
    })
  })

  it('returns no config when no alias is set (targets are reached by their own host name)', () => {
    expect(buildFirefoxPrefsConfig(undefined)).toEqual({})
  })
})
