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
 * - **Query surface only, no request body.** Discovery captures no body shape,
 *   and the issue forbids inventing one; a non-GET target with no query
 *   parameter has no valid fuzz seed and is skipped-with-reason
 *   (`skippedNoFuzzSeed`), never given a synthetic body.
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
    // No query parameter → no fuzz seed (a body would have to be invented,
    // which the issue forbids). Count and skip.
    if (params.length === 0) {
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
    // No requestBody for any verb: we have no schema to seed (Epic #41 PR3).
    item[t.method.toLowerCase()] = {
      parameters: params,
      responses: { '200': { description: 'ok' } },
    }
  }

  const docs: GeneratedOpenApiDoc[] = []
  for (const group of byOrigin.values())
    for (const shard of group.shards)
      docs.push({ origin: group.origin, originalHost: group.originalHost, doc: shard.doc })
  return { docs, skippedNoFuzzSeed }
}
