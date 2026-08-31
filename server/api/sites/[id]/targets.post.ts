import { defineEventHandler } from 'h3'
import { siteDeps } from '../../../lib/deps'
import { parseBody, requireParam, toHttpError } from '../../../lib/http'
import { addSiteTargets } from '../../../services/siteService'
import { AddTargetsBodySchema } from '#shared/schemas/targets'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const { lines } = await parseBody(event, AddTargetsBodySchema)
  try {
    return addSiteTargets(siteDeps(), id, lines)
  } catch (e) {
    toHttpError(e)
  }
})
