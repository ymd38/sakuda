import { defineEventHandler } from 'h3'
import { siteDeps } from '../../lib/deps'
import { parseBody, requireParam, toHttpError } from '../../lib/http'
import { updateSite } from '../../services/siteService'
import { SiteUpdateSchema } from '#shared/schemas/site'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, SiteUpdateSchema)
  try {
    return updateSite(siteDeps(), id, input)
  } catch (e) {
    toHttpError(e)
  }
})
