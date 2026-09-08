import { z } from 'zod'
import type { BodyShape, JsonFieldShape, RequestShape } from '../types/api'

/** Validates one JSON node's shape (see `BodyShape`). Recursive via `z.lazy`.
 * The structure carries only names and type labels — never a captured value. */
const JsonFieldShapeSchema: z.ZodType<JsonFieldShape> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'null', 'object', 'array']),
    fields: z.record(z.string(), JsonFieldShapeSchema).optional(),
    items: z.array(JsonFieldShapeSchema).optional(),
    truncated: z.literal(true).optional(),
  }),
)

/** Validates a value-free request-body shape read back from the site-tree dump
 * or an API payload — defence in depth over the dump script's own output. */
export const BodyShapeSchema: z.ZodType<BodyShape> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), root: JsonFieldShapeSchema }),
  z.object({ kind: z.literal('form'), fields: z.array(z.string()) }),
  z.object({ kind: z.literal('other') }),
])

/** One saved request shape: the observed media type plus the value-free body
 * shape. Keyed by `targetLineKey` in `sites.requestShapes`. */
export const RequestShapeSchema: z.ZodType<RequestShape> = z.object({
  contentType: z.string().max(300).nullable(),
  bodyShape: BodyShapeSchema,
})

/** Map of `targetLineKey` → request shape, as stored on a site. */
export const RequestShapesSchema = z.record(z.string(), RequestShapeSchema)
