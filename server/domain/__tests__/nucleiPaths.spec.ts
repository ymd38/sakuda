import { describe, expect, it } from 'vitest'
import {
  normalizeTargetMethod,
  parseNucleiPathLines,
  targetLineKey,
} from '#shared/utils/nucleiPaths'

describe('normalizeTargetMethod', () => {
  it('uppercases and validates against the allowlist', () => {
    expect(normalizeTargetMethod('get')).toBe('GET')
    expect(normalizeTargetMethod(' Post ')).toBe('POST')
    expect(normalizeTargetMethod('DELETE')).toBe('DELETE')
  })
  it('returns null for anything unsupported', () => {
    expect(normalizeTargetMethod('TRACE')).toBeNull()
    expect(normalizeTargetMethod('CONNECT')).toBeNull()
    expect(normalizeTargetMethod('nonsense')).toBeNull()
  })
})

describe('parseNucleiPathLines', () => {
  it('defaults a bare path to GET and keeps the api: prefix', () => {
    const { lines, errors } = parseNucleiPathLines('/x\napi:/y\n# comment\n')
    expect(errors).toEqual([])
    expect(lines).toEqual([
      { lineNo: 1, method: 'GET', base: 'front', path: '/x' },
      { lineNo: 2, method: 'GET', base: 'api', path: '/y' },
    ])
  })

  it('parses a leading HTTP method (case-insensitive) before an optional api: prefix', () => {
    const { lines, errors } = parseNucleiPathLines('POST /api/x\ndelete api:/y\nPUT /z?q=1')
    expect(errors).toEqual([])
    expect(lines).toEqual([
      { lineNo: 1, method: 'POST', base: 'front', path: '/api/x' },
      { lineNo: 2, method: 'DELETE', base: 'api', path: '/y' },
      { lineNo: 3, method: 'PUT', base: 'front', path: '/z?q=1' },
    ])
  })

  it('reports an unsupported method and a missing path, keeping other lines', () => {
    const { lines, errors } = parseNucleiPathLines('TRACE /x\nnotapath\nGET /ok')
    expect(lines).toEqual([{ lineNo: 3, method: 'GET', base: 'front', path: '/ok' }])
    expect(errors[0]).toContain('unsupported HTTP method "TRACE"')
    expect(errors[1]).toContain('line 2')
  })
})

describe('targetLineKey', () => {
  it('makes GET-and-omitted collapse, and different methods distinct', () => {
    const [get] = parseNucleiPathLines('/x').lines
    const [getExplicit] = parseNucleiPathLines('GET /x').lines
    const [post] = parseNucleiPathLines('POST /x').lines
    const [apiGet] = parseNucleiPathLines('api:/x').lines
    expect(targetLineKey(get!)).toBe(targetLineKey(getExplicit!))
    expect(targetLineKey(post!)).not.toBe(targetLineKey(get!))
    expect(targetLineKey(apiGet!)).not.toBe(targetLineKey(get!))
    expect(targetLineKey(get!)).toBe('GET|front|/x')
  })
})
