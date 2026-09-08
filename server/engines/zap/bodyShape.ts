import type { BodyShape, JsonFieldShape } from '#shared/types/api'

/**
 * Turns a captured request body into a value-free SHAPE: JSON → key names and
 * JSON types (nested, depth-capped); form-urlencoded → field names; anything
 * else (multipart, text, malformed) → `{ kind: 'other' }`. Returns `null` for
 * an empty body so the caller omits the field entirely.
 *
 * IMPORTANT — this function's SOURCE is embedded verbatim into the ZAP Graal.js
 * site-tree dump script (see `siteTreeDump.ts`) via `Function.prototype
 * .toString()`, so that the exact logic covered by unit tests is what runs
 * inside ZAP and only shapes (never raw values) are ever written to disk.
 * For that embedding to be safe it MUST stay self-contained: no imports, no
 * references to module-scope bindings (the depth cap is a local `MAX_DEPTH`),
 * no recursion via its own outer name (the inner `shapeJson` helper carries all
 * recursion), and only conservative ES2019 syntax that GraalJS accepts. Do not
 * use optional chaining, nullish coalescing, spread, or template literals here.
 */
export function toBodyShape(contentType: string | null, rawBody: string): BodyShape | null {
  const MAX_DEPTH = 3
  if (rawBody == null) return null
  const body = String(rawBody)
  if (body.length === 0 || body.trim().length === 0) return null

  const ct = contentType == null ? '' : String(contentType).toLowerCase()
  const semi = ct.indexOf(';')
  const mediaType = (semi === -1 ? ct : ct.slice(0, semi)).trim()

  function shapeJson(value: unknown, depth: number): JsonFieldShape {
    if (value === null) return { type: 'null' }
    if (Array.isArray(value)) {
      if (depth >= MAX_DEPTH) return { type: 'array', truncated: true }
      const items: JsonFieldShape[] = []
      const seen: string[] = []
      for (const element of value) {
        const itemShape = shapeJson(element, depth + 1)
        const key = JSON.stringify(itemShape)
        if (seen.indexOf(key) === -1) {
          seen.push(key)
          items.push(itemShape)
        }
      }
      return { type: 'array', items: items }
    }
    const t = typeof value
    if (t === 'object') {
      if (depth >= MAX_DEPTH) return { type: 'object', truncated: true }
      const fields: Record<string, JsonFieldShape> = {}
      const obj = value as Record<string, unknown>
      for (const name of Object.keys(obj)) fields[name] = shapeJson(obj[name], depth + 1)
      return { type: 'object', fields: fields }
    }
    if (t === 'number') return { type: 'number' }
    if (t === 'boolean') return { type: 'boolean' }
    return { type: 'string' }
  }

  if (mediaType === 'application/json' || mediaType.indexOf('+json') !== -1) {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return { kind: 'other' }
    }
    return { kind: 'json', root: shapeJson(parsed, 0) }
  }

  if (mediaType === 'application/x-www-form-urlencoded') {
    const fieldNames: string[] = []
    for (const pair of body.split('&')) {
      if (pair.length === 0) continue
      const eq = pair.indexOf('=')
      const rawName = eq === -1 ? pair : pair.slice(0, eq)
      let fieldName: string
      try {
        fieldName = decodeURIComponent(rawName.replace(/\+/g, ' '))
      } catch {
        fieldName = rawName
      }
      if (fieldName.length > 0 && fieldNames.indexOf(fieldName) === -1) fieldNames.push(fieldName)
    }
    return { kind: 'form', fields: fieldNames }
  }

  return { kind: 'other' }
}

/** Re-exported for existing importers; the schema itself lives in
 * `#shared/schemas/bodyShape` so client code and the API boundary can share it. */
export { BodyShapeSchema } from '#shared/schemas/bodyShape'

/** Source of `toBodyShape` for embedding into the Graal.js dump script. Kept as
 * a named function expression assignment so the script can call `toBodyShape`
 * by that fixed name regardless of how the bundler names the export binding. */
export function bodyShapeFunctionSource(): string {
  return 'var toBodyShape = ' + toBodyShape.toString() + ';'
}
