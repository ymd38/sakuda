import { defineEventHandler, setResponseStatus } from 'h3'
import { siteDeps } from '../../lib/deps'
import { parseBody, toHttpError } from '../../lib/http'
import { createSite } from '../../services/siteService'
import { SiteInputSchema } from '#shared/schemas/site'

export default defineEventHandler(async (event) => {
  const input = await parseBody(event, SiteInputSchema)
  try {
    const site = createSite(siteDeps(), input)
    setResponseStatus(event, 201)
    return site
  } catch (e) {
    toHttpError(e)
  }
})
