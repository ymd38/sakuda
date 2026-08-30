import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { getDb } from '../../db/client'
import { requireParam, toHttpError } from '../../lib/http'
import { deleteSite } from '../../services/siteService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  try {
    const deleted = deleteSite(getDb(), id)
    if (!deleted) throw createError({ statusCode: 404, statusMessage: 'site not found' })
    setResponseStatus(event, 204)
    return null
  } catch (e) {
    toHttpError(e)
  }
})
