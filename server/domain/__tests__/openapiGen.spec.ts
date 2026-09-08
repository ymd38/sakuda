import { describe, expect, it } from 'vitest'
import { buildNonGetOpenApiDocs, type GeneratedOpenApiDoc } from '../openapiGen'
import type { ExpandedTarget } from '../nucleiTargets'

const t = (method: ExpandedTarget['method'], url: string): ExpandedTarget => {
  const u = new URL(url)
  return { method, base: url.includes(':8080') ? 'api' : 'front', url, path: u.pathname + u.search }
}
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

  it('turns a JSON shape into a requestBody with synthetic values (no query needed)', () => {
    const shapes = {
      'POST|front|/rest/user/login': {
        contentType: 'application/json',
        bodyShape: {
          kind: 'json' as const,
          root: {
            type: 'object' as const,
            fields: {
              email: { type: 'string' as const },
              n: { type: 'number' as const },
              nested: {
                type: 'object' as const,
                fields: { ok: { type: 'boolean' as const } },
              },
            },
          },
        },
      },
    }
    const { docs, skippedNoFuzzSeed } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/rest/user/login')],
      id,
      seed1,
      shapes,
    )
    expect(skippedNoFuzzSeed).toEqual({})
    const op = paths(docs[0]!)['/rest/user/login']!.post!
    expect(op.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              n: { type: 'number' },
              nested: { type: 'object', properties: { ok: { type: 'boolean' } } },
            },
          },
          example: { email: 'test', n: 1, nested: { ok: true } },
        },
      },
    })
    // synthetic values only — no observed value could appear (shapes carry none)
    expect(JSON.stringify(docs[0]!.doc)).not.toContain('password')
  })

  it('turns a form shape into a urlencoded requestBody of string fields', () => {
    const shapes = {
      'POST|front|/contact': {
        contentType: null,
        bodyShape: { kind: 'form' as const, fields: ['name', 'message'] },
      },
    }
    const { docs } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/contact')],
      id,
      seed1,
      shapes,
    )
    expect(paths(docs[0]!)['/contact']!.post!.requestBody).toEqual({
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, message: { type: 'string' } },
          },
          example: { name: 'test', message: 'test' },
        },
      },
    })
  })

  it('does not treat an "other" shape as a fuzz seed: no query + other → skipped', () => {
    const shapes = {
      'POST|front|/upload': {
        contentType: 'multipart/form-data',
        bodyShape: { kind: 'other' as const },
      },
    }
    const { docs, skippedNoFuzzSeed } = buildNonGetOpenApiDocs(
      [t('POST', 'http://localhost:3000/upload')],
      id,
      seed1,
      shapes,
    )
    expect(docs).toEqual([])
    expect(skippedNoFuzzSeed).toEqual({ POST: 1 })
  })
})
