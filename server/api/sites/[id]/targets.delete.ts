import { defineEventHandler } from 'h3'
import { siteDeps } from '../../../lib/deps'
import { parseBody, requireParam, toHttpError } from '../../../lib/http'
import { removeSiteTarget } from '../../../services/siteService'
import { RemoveTargetBodySchema } from '#shared/schemas/targets'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const { line } = await parseBody(event, RemoveTargetBodySchema)
  try {
    return removeSiteTarget(siteDeps(), id, line)
  } catch (e) {
    toHttpError(e)
  }
})
