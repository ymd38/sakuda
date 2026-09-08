import { targetLineKey } from '#shared/utils/nucleiPaths'
import type { BodyShape, JsonFieldShape, RequestShape } from '#shared/types/api'
import type { ExpandedTarget, SkippedMethods } from './nucleiTargets'

/** One generated OpenAPI document plus the original hostname its findings
 * should be un-aliased back to (see `restoreLoopbackHost`). A document is
 * scoped to a single origin — nuclei's `-im openapi` runs it against that
 * one server. */
export interface GeneratedOpenApiDoc {
  /** Rewritten origin the doc's `servers[0].url` points at (container-side). */
  origin: string
  /** Original hostname of that origin, for un-aliasing matched-at URLs. */
  originalHost: string
  doc: Record<string, unknown>
}

/** A query-parameter shape lifted from a URL: name + the value to seed the
 * fuzzer with (empty values already replaced upstream). */
function queryParams(
  url: URL,
): Array<{ name: string; in: 'query'; example: string; schema: { type: 'string' } }> {
  const params: Array<{ name: string; in: 'query'; example: string; schema: { type: 'string' } }> =
    []
  const seen = new Set<string>()
  for (const [name, value] of url.searchParams) {
    if (seen.has(name)) continue // one parameter per name; first value wins
    seen.add(name)
    params.push({ name, in: 'query', example: value, schema: { type: 'string' } })
  }
  return params
}

/** OpenAPI 3 schema for one JSON node shape (names + types only). A container
 * beyond the shape's depth cap (`truncated`) becomes an open object/array. */
function jsonSchemaOf(shape: JsonFieldShape): Record<string, unknown> {
  switch (shape.type) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'null':
      return { type: 'string', nullable: true }
    case 'object': {
      if (shape.truncated || !shape.fields) return { type: 'object' }
      const properties: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(shape.fields)) properties[k] = jsonSchemaOf(v)
      return { type: 'object', properties }
    }
    case 'array': {
      if (shape.truncated || !shape.items || shape.items.length === 0)
        return { type: 'array', items: {} }
      return { type: 'array', items: jsonSchemaOf(shape.items[0]!) }
    }
    default:
      return { type: 'string' }
  }
}

/** A synthetic example value for a JSON node shape — never an observed value.
 * Strings are `"test"`, numbers `1`, booleans `true`, so the fuzzer has a
 * concrete seed to mutate for every field. */
function jsonExampleOf(shape: JsonFieldShape): unknown {
  switch (shape.type) {
    case 'number':
      return 1
    case 'boolean':
      return true
    case 'null':
      return null
    case 'object': {
      if (shape.truncated || !shape.fields) return {}
      const example: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(shape.fields)) example[k] = jsonExampleOf(v)
      return example
    }
    case 'array': {
      if (shape.truncated || !shape.items || shape.items.length === 0) return []
      return [jsonExampleOf(shape.items[0]!)]
    }
    default:
      return 'test'
  }
}

/** OpenAPI media type for a shape: the observed Content-Type (params stripped)
 * when present, else derived from the shape kind. */
function mediaTypeOf(shape: BodyShape, contentType: string | null): string {
  if (contentType) {
    const mt = contentType.split(';')[0]?.trim().toLowerCase()
    if (mt) return mt
  }
  return shape.kind === 'form' ? 'application/x-www-form-urlencoded' : 'application/json'
}

/** Builds an OpenAPI `requestBody` (schema + synthetic example) from a captured
 * shape, or `undefined` when there is nothing fuzzable (kind `other`, e.g.
 * multipart/text). No observed value is ever emitted — only names, types, and
 * synthetic seeds. */
function buildRequestBody(rs: RequestShape): Record<string, unknown> | undefined {
  const { contentType, bodyShape } = rs
  if (bodyShape.kind === 'other') return undefined
  const mediaType = mediaTypeOf(bodyShape, contentType)
  if (bodyShape.kind === 'form') {
    const properties: Record<string, unknown> = {}
    const example: Record<string, unknown> = {}
    for (const field of bodyShape.fields) {
      properties[field] = { type: 'string' }
      example[field] = 'test'
    }
    return { content: { [mediaType]: { schema: { type: 'object', properties }, example } } }
  }
  return {
    content: {
      [mediaType]: {
        schema: jsonSchemaOf(bodyShape.root),
        example: jsonExampleOf(bodyShape.root),
      },
    },
  }
}

function emptyDoc(origin: string): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'sakuda-generated', version: '1' },
    servers: [{ url: origin }],
    paths: {} as Record<string, Record<string, unknown>>,
  }
}

/**
 * Builds temporary OpenAPI 3 documents for approved non-GET targets so nuclei
 * can DAST-fuzz them (`-im openapi -dast`), following Epic #41 PR3's design:
 *
 * - **One document per origin.** A document's paths are relative to its single
 *   `server`, so mixing origins would be ambiguous.
 * - **Query surface, plus a request body when a shape was captured (#73).** A
 *   non-GET target whose saved line has a request shape (`sites.requestShapes`)
 *   gets a `requestBody` with synthetic values; one with neither a query
 *   parameter nor a fuzzable shape has no valid fuzz seed and is
 *   skipped-with-reason (`skippedNoFuzzSeed`), never given an invented body.
 * - **Literal paths.** `URL.pathname` is used undecoded so a real `{id}` is not
 *   read as OpenAPI path templating.
 * - **Collision sharding.** OpenAPI allows one operation per (path, method);
 *   two approved shapes of the same `POST /s` land in separate documents so
 *   each query shape is preserved rather than merged.
 *
 * `rewriteUrl` applies the loopback→alias rewrite (container networking) and
 * `seedUrl` fills empty query values (`?q=` → `?q=1`) — both injected so this
 * stays a pure data transform. The caller passes the non-GET, non-hash
 * targets; `origin`/`originalHost` are taken from the target URL before/after
 * the rewrite so each document's findings restore to the right host.
 */
export function buildNonGetOpenApiDocs(
  targets: ExpandedTarget[],
  rewriteUrl: (url: string) => string,
  seedUrl: (url: string) => string,
  requestShapes: Record<string, RequestShape> = {},
): { docs: GeneratedOpenApiDoc[]; skippedNoFuzzSeed: SkippedMethods } {
  const skippedNoFuzzSeed: SkippedMethods = {}
  // Per original origin: the original host + a list of shard docs (each doc a
  // map of pathname → set of methods already placed, so a collision opens a
  // new shard).
  const byOrigin = new Map<
    string,
    {
      originalHost: string
      origin: string
      shards: Array<{ used: Set<string>; doc: Record<string, unknown> }>
    }
  >()

  for (const t of targets) {
    const original = new URL(t.url)
    const rewritten = new URL(rewriteUrl(seedUrl(t.url)))
    const params = queryParams(rewritten)
    const shape = requestShapes[targetLineKey({ method: t.method, base: t.base, path: t.path })]
    const requestBody = shape ? buildRequestBody(shape) : undefined
    // Fuzz seed = a query parameter or a captured body shape. With neither
    // (no query and no fuzzable shape) a body would have to be invented, which
    // the issue forbids — count and skip.
    if (params.length === 0 && !requestBody) {
      skippedNoFuzzSeed[t.method] = (skippedNoFuzzSeed[t.method] ?? 0) + 1
      continue
    }
    const key = original.origin
    let group = byOrigin.get(key)
    if (!group) {
      group = { originalHost: original.hostname, origin: rewritten.origin, shards: [] }
      byOrigin.set(key, group)
    }
    const opKey = `${rewritten.pathname} ${t.method}`
    let shard = group.shards.find((s) => !s.used.has(opKey))
    if (!shard) {
      shard = { used: new Set(), doc: emptyDoc(group.origin) }
      group.shards.push(shard)
    }
    shard.used.add(opKey)
    const paths = shard.doc.paths as Record<string, Record<string, unknown>>
    const item = (paths[rewritten.pathname] ??= {})
    item[t.method.toLowerCase()] = {
      parameters: params,
      // A captured shape adds a requestBody with synthetic values (#73); a
      // target with only a query still has none.
      ...(requestBody ? { requestBody } : {}),
      responses: { '200': { description: 'ok' } },
    }
  }

  const docs: GeneratedOpenApiDoc[] = []
  for (const group of byOrigin.values())
    for (const shard of group.shards)
      docs.push({ origin: group.origin, originalHost: group.originalHost, doc: shard.doc })
  return { docs, skippedNoFuzzSeed }
}
