import { createError, defineEventHandler } from 'h3'
import { getDb } from '../../../db/client'
import { summarizeTargets } from '../../../domain/targetSummary'
import { requireParam } from '../../../lib/http'
import { getSite } from '../../../services/siteService'

/** Read-only: the saved target list and what each engine will do with it.
 * Editing goes through POST/DELETE on this same path. */
export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const site = getSite(getDb(), id)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'site not found' })
  return summarizeTargets(site)
})
