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
})

describe('historyTypeToSource', () => {
  it('maps ZAP history types to spider / ajax / client / other', () => {
    expect(historyTypeToSource(2)).toBe('spider')
    expect(historyTypeToSource(10)).toBe('ajax')
    expect(historyTypeToSource(24)).toBe('client')
    expect(historyTypeToSource(1)).toBe('other')
  })
})
