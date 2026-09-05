import { describe, expect, it } from 'vitest'
import { buildKatanaArgs } from '../args'

describe('buildKatanaArgs', () => {
  it('builds a static, fqdn-scoped, JSONL crawl bounded by the minute budget', () => {
    const args = buildKatanaArgs({
      seedsFile: '/w/seeds.txt',
      outputFile: '/w/urls.jsonl',
      maxMinutes: 5,
      headers: [],
    })
    expect(args).toEqual([
      '-list',
      '/w/seeds.txt',
      '-jc',
      '-kf',
      'all',
      '-d',
      '3',
      '-fs',
      'fqdn',
      '-ct',
      '5m',
      '-jsonl',
      '-o',
      '/w/urls.jsonl',
      '-silent',
      '-nc',
      '-duc',
      '-eof',
      'raw,body,headers',
    ])
    // Static mode only — never the headless browser.
    expect(args).not.toContain('-headless')
    expect(args).not.toContain('-hl')
    // -omit-body silently disables JS-bundle parsing in katana 1.7.0.
    expect(args).not.toContain('-omit-body')
    expect(args).not.toContain('-ob')
  })

  it('appends one -H pair per header', () => {
    const args = buildKatanaArgs({
      seedsFile: 's',
      outputFile: 'o',
      maxMinutes: 1,
      headers: [
        { name: 'Cookie', value: 'a=b' },
        { name: 'Authorization', value: 'Bearer x' },
      ],
    })
    expect(args.slice(-4)).toEqual(['-H', 'Cookie: a=b', '-H', 'Authorization: Bearer x'])
  })
})
