import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSiteTreeDumpScript,
  historyTypeToSource,
  parseSiteTreeDump,
  SITE_TREE_DUMP_ENGINE,
} from '../siteTreeDump'

const FIXTURE = join(__dirname, 'fixtures', 'site-tree.jsonl')

describe('buildSiteTreeDumpScript', () => {
  it('embeds the output path as a JSON string literal and walks the site tree', () => {
    const script = buildSiteTreeDumpScript('/zap/wrk/site-tree.jsonl')
    expect(script).toContain('Paths.get("/zap/wrk/site-tree.jsonl")')
    expect(script).toContain('getSiteTree().getRoot()')
    expect(script).toContain('getHistoryType()')
    expect(SITE_TREE_DUMP_ENGINE).toBe('ECMAScript : Graal.js')
  })

  it('escapes a path that would otherwise break out of the string literal', () => {
    const script = buildSiteTreeDumpScript('/tmp/a"b\\c/site-tree.jsonl')
    expect(script).toContain('Paths.get("/tmp/a\\"b\\\\c/site-tree.jsonl")')
  })

  it('embeds the body-shape function and captures bodies for non-GET nodes only', () => {
    const script = buildSiteTreeDumpScript('/zap/wrk/site-tree.jsonl')
    // The tested shaping function is inlined, and the walk reads the request body
    // only for non-GET/HEAD nodes (via getHttpMessage), writing shapes not values.
    expect(script).toContain('var toBodyShape = ')
    expect(script).toContain('getHttpMessage()')
    expect(script).toContain("method !== 'GET' && method !== 'HEAD'")
    expect(script).toContain('entry.bodyShape = shape')
  })
})

describe('parseSiteTreeDump', () => {
  it('keeps requested nodes, drops structural (status 0) nodes, counts unparsable lines', () => {
    const { entries, structuralCount, invalidLines } = parseSiteTreeDump(
      readFileSync(FIXTURE, 'utf8'),
    )
    expect(structuralCount).toBe(2)
    expect(invalidLines).toBe(1)
    expect(entries).toHaveLength(10)
    expect(entries[0]).toEqual({
      method: 'GET',
      url: 'http://host.docker.internal:3000/',
      type: 2,
      status: 200,
    })
  })

  it('treats a JSON line with the wrong shape as invalid', () => {
    const { entries, invalidLines } = parseSiteTreeDump(
      '{"url":"x"}\n{"method":"GET","url":"u","type":"2","status":200}\n',
    )
    expect(entries).toEqual([])
    expect(invalidLines).toBe(2)
  })

  it('returns nothing for empty input', () => {
    expect(parseSiteTreeDump('')).toEqual({ entries: [], structuralCount: 0, invalidLines: 0 })
  })

  it('parses contentType + bodyShape when present and old lines without them still pass', () => {
    const withShape = JSON.stringify({
      method: 'POST',
      url: 'http://h/rest/user/login',
      type: 24,
      status: 401,
      contentType: 'application/json',
      bodyShape: { kind: 'json', root: { type: 'object', fields: { email: { type: 'string' } } } },
    })
    const oldLine = JSON.stringify({ method: 'GET', url: 'http://h/', type: 2, status: 200 })
    const { entries, invalidLines } = parseSiteTreeDump(`${withShape}\n${oldLine}\n`)
    expect(invalidLines).toBe(0)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.bodyShape).toEqual({
      kind: 'json',
      root: { type: 'object', fields: { email: { type: 'string' } } },
    })
    expect(entries[0]?.contentType).toBe('application/json')
    expect(entries[1]?.bodyShape).toBeUndefined()
  })

  it('rejects a line whose bodyShape is structurally invalid', () => {
    const bad = JSON.stringify({
      method: 'POST',
      url: 'http://h/x',
      type: 24,
      status: 200,
      bodyShape: { kind: 'json', root: { type: 'not-a-type' } },
    })
    expect(parseSiteTreeDump(`${bad}\n`).invalidLines).toBe(1)
  })
})

describe('historyTypeToSource', () => {
  it('maps ZAP history types to spider / ajax / client / other', () => {
    expect(historyTypeToSource(2)).toBe('spider')
    expect(historyTypeToSource(10)).toBe('ajax')
    expect(historyTypeToSource(24)).toBe('client')
    expect(historyTypeToSource(1)).toBe('other')
  })
})
