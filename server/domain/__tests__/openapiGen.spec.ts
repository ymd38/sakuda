import { describe, expect, it } from 'vitest'
import { buildNonGetOpenApiDocs, type GeneratedOpenApiDoc } from '../openapiGen'
import type { ExpandedTarget } from '../nucleiTargets'

const t = (method: ExpandedTarget['method'], url: string): ExpandedTarget => ({
  method,
  base: url.includes(':8080') ? 'api' : 'front',
  url,
})
const id = (u: string) => u
const seed1 = (u: string) => {
  const url = new URL(u)
  for (const k of [...url.searchParams.keys()])
    if (url.searchParams.get(k) === '') url.searchParams.set(k, '1')
  return url.toString()
}

interface Operation {
  parameters?: Array<{ name: string; in: string; example: string; schema: { type: string } }>
  requestBody?: unknown
  responses: Record<string, unknown>
}
type PathItem = Partial<Record<'get' | 'post' | 'put' | 'delete', Operation>>
const paths = (d: GeneratedOpenApiDoc) => d.doc.paths as Record<string, PathItem>

describe('buildNonGetOpenApiDocs', () => {
  it('emits one doc per origin, query params as parameters, no requestBody, literal path', () => {
    const { docs, skippedNoFuzzSeed } = buildNonGetOpenApiDocs(
      [
        t('POST', 'http://localhost:3000/rest/products/search?q=a'),
        t('PUT', 'http://localhost:8080/v1/items/{id}?f=1'),
      ],
      id,
      seed1,
    )
    expect(skippedNoFuzzSeed).toEqual({})
    expect(docs).toHaveLength(2)

    const front = docs.find((d) => d.origin === 'http://localhost:3000')!
    expect(front.originalHost).toBe('localhost')
    const search = paths(front)['/rest/products/search']!.post!
    expect(search.parameters).toEqual([
      { name: 'q', in: 'query', example: 'a', schema: { type: 'string' } },
    ])
    expect(search.requestBody).toBeUndefined()
    expect(front.doc.servers).toEqual([{ url: 'http://localhost:3000' }])

    const api = docs.find((d) => d.origin === 'http://localhost:8080')!
    // `URL.pathname` percent-encodes the braces, so a real `{id}` becomes
    // `%7Bid%7D` and can never be read as OpenAPI path templating.
    expect(Object.keys(paths(api))).toEqual(['/v1/items/%7Bid%7D'])
    expect(paths(api)['/v1/items/%7Bid%7D']!.put!.parameters![0]!.name).toBe('f')
  })

  it('skips a non-GET target with no query (no valid fuzz seed), counting it by method', () => {
    const { docs, skippedNoFuzzSeed } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/rest/user/login'), t('DELETE', 'http://localhost:3000/x')],
      id,
      seed1,
    )
    expect(docs).toEqual([])
    expect(skippedNoFuzzSeed).toEqual({ POST: 1, DELETE: 1 })
  })

  it('seeds an empty query value via the injected seed fn (?q= → ?q=1)', () => {
    const { docs } = buildNonGetOpenApiDocs([t('POST', 'http://localhost:3000/s?q=')], id, seed1)
    expect(paths(docs[0]!)['/s']!.post!.parameters![0]!.example).toBe('1')
  })

  it('shards colliding (path, method) shapes into separate docs, preserving each query', () => {
    const { docs } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/s?q=a'), t('POST', 'http://localhost:3000/s?q=b')],
      id,
      seed1,
    )
    const postDocs = docs.filter((d) => paths(d)['/s']?.post)
    expect(postDocs).toHaveLength(2)
    expect(postDocs.map((d) => paths(d)['/s']!.post!.parameters![0]!.example).sort()).toEqual([
      'a',
      'b',
    ])
  })

  it('applies the injected rewrite to the server URL but restores to the original host', () => {
    const rewrite = (u: string) => u.replace('localhost', 'host.docker.internal')
    const { docs } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/s?q=a')],
      rewrite,
      seed1,
    )
    expect(docs[0]!.origin).toBe('http://host.docker.internal:3000')
    expect(docs[0]!.originalHost).toBe('localhost')
    expect(docs[0]!.doc.servers).toEqual([{ url: 'http://host.docker.internal:3000' }])
  })
})
