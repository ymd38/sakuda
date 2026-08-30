import { defineEventHandler } from 'h3'
import { siteDeps } from '../../lib/deps'
import { parseBody, requireParam, toHttpError } from '../../lib/http'
import { updateSite } from '../../services/siteService'
import { SiteInputSchema } from '#shared/schemas/site'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, SiteInputSchema)
  try {
    return updateSite(siteDeps(), id, input)
  } catch (e) {
    toHttpError(e)
  }
})
