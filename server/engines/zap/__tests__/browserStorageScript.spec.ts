import { describe, expect, it } from 'vitest'
import { buildBrowserStorageScript, BROWSER_STORAGE_SCRIPT_ENGINE } from '../browserStorageScript'

describe('buildBrowserStorageScript', () => {
  const items = [
    { kind: 'localStorage' as const, name: 'token', value: 'ey"J\'.<script>' },
    { kind: 'sessionStorage' as const, name: 'bid', value: '6' },
    { kind: 'cookie' as const, name: 'token', value: 'eyJ.abc' },
  ]

  it('embeds items and origins as JSON, and passes values as executeScript arguments', () => {
    const script = buildBrowserStorageScript(items, ['http://host.docker.internal:4001'])
    expect(script).toContain(`var ITEMS = ${JSON.stringify(items)};`)
    expect(script).toContain('var ORIGINS = ["http://host.docker.internal:4001"];')
    // the value never appears unescaped inside JS source — only inside the JSON literal
    expect(script.split(items[0]!.value)).toHaveLength(1) // raw value not present
    expect(script).toContain('window[arguments[0]].setItem(arguments[1], arguments[2])')
    expect(script).toContain("document.cookie = arguments[0] + '=' + arguments[1] + '; path=/'")
  })

  it('defines the browserLaunched hook, navigates to the origin first and reloads at the end', () => {
    const script = buildBrowserStorageScript(items, ['http://a.example', 'http://b.example'])
    expect(script).toContain('function browserLaunched(utils)')
    expect(script).toContain("wd.get(ORIGINS[o] + '/')")
    expect(script).toContain("wd.executeScript('location.reload()')")
    expect(BROWSER_STORAGE_SCRIPT_ENGINE).toBe('ECMAScript : Graal.js')
  })
})
