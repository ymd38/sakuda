import { z } from 'zod'

/** Body of `POST /api/sites/:id/targets`: target lines (`/path` or
 * `api:/path`) to append to the site's saved list. Line syntax itself is
 * validated by `mergeTargetLines`, which reports every bad line at once. */
export const AddTargetsBodySchema = z.object({
  lines: z.array(z.string().max(2_000)).min(1).max(1_000),
})

export type AddTargetsBody = z.infer<typeof AddTargetsBodySchema>
