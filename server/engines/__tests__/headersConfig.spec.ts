import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { headersConfigArgs, headersConfigJson, withHeadersConfig } from '../headersConfig'

const headers = [
  { name: 'Cookie', value: 'a="q"; b=c:d # not a comment' },
  { name: 'Authorization', value: 'Bearer x' },
]

describe('headersConfigJson', () => {
  it('emits the tool key with one "Name: value" string per header, JSON-escaped', () => {
    expect(JSON.parse(headersConfigJson(headers, 'header'))).toEqual({
      header: ['Cookie: a="q"; b=c:d # not a comment', 'Authorization: Bearer x'],
    })
    expect(JSON.parse(headersConfigJson(headers, 'headers'))).toEqual({
      headers: ['Cookie: a="q"; b=c:d # not a comment', 'Authorization: Bearer x'],
    })
  })
})

describe('withHeadersConfig', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-headers-'))
  })

  it('writes the file 0600 (creating the dir) for the duration of fn, then removes it', async () => {
    const path = join(tmp, 'work', 'headers.json')
    const seen = await withHeadersConfig(path, headers, 'header', async (file) => {
      expect(file).toBe(path)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      return readFileSync(path, 'utf8')
    })
    expect(JSON.parse(seen)).toEqual(JSON.parse(headersConfigJson(headers, 'header')))
    expect(existsSync(path)).toBe(false)
  })

  it('replaces a pre-existing file with wider permissions instead of inheriting its mode', async () => {
    const path = join(tmp, 'headers.json')
    writeFileSync(path, '{"header":["X-Stale: 1"]}', { mode: 0o644 })
    expect(statSync(path).mode & 0o777).toBe(0o644)
    await withHeadersConfig(path, headers, 'header', async () => {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(
        JSON.parse(headersConfigJson(headers, 'header')),
      )
    })
    expect(existsSync(path)).toBe(false)
  })

  it('removes the file when fn throws, and rethrows', async () => {
    const path = join(tmp, 'headers.json')
    await expect(
      withHeadersConfig(path, headers, 'header', async () => {
        expect(existsSync(path)).toBe(true)
        throw new Error('engine failed')
      }),
    ).rejects.toThrow('engine failed')
    expect(existsSync(path)).toBe(false)
  })

  it('passes null and writes nothing when there are no headers', async () => {
    const path = join(tmp, 'headers.json')
    const got = await withHeadersConfig(path, [], 'headers', async (file) => file)
    expect(got).toBeNull()
    expect(existsSync(path)).toBe(false)
  })
})

describe('headersConfigArgs', () => {
  it('is -config <file> with a file and empty without', () => {
    expect(headersConfigArgs('/w/headers.json')).toEqual(['-config', '/w/headers.json'])
    expect(headersConfigArgs(null)).toEqual([])
  })
})
