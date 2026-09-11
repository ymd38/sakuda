import { z } from 'zod'
import { BodyShapeSchema } from './bodyShape'

/** One captured request shape for a line being approved: the target line it
 * belongs to (same grammar as `lines`), the observed media type, and the
 * value-free body shape. The server resolves the line to a `targetLineKey`
 * and stores the shape under it (see `addSiteTargets`). */
export const TargetShapeSchema = z.object({
  line: z.string().max(2_000),
  contentType: z.string().max(300).nullable(),
  bodyShape: BodyShapeSchema,
})

/** Body of `POST /api/sites/:id/targets`: target lines (`/path` or
 * `api:/path`) to append to the site's saved list, plus optional value-free
 * request shapes for approved non-GET lines. Line syntax itself is validated
 * by `mergeTargetLines`, which reports every bad line at once. */
export const AddTargetsBodySchema = z.object({
  lines: z.array(z.string().max(2_000)).min(1).max(1_000),
  shapes: z.array(TargetShapeSchema).max(1_000).optional(),
})

export type AddTargetsBody = z.infer<typeof AddTargetsBodySchema>
export type TargetShape = z.infer<typeof TargetShapeSchema>

/** Body of `DELETE /api/sites/:id/targets`: the one saved target line to
 * remove (same grammar as `lines`; identity is method + base + path). */
export const RemoveTargetBodySchema = z.object({
  line: z.string().min(1).max(2_000),
})

export type RemoveTargetBody = z.infer<typeof RemoveTargetBodySchema>
