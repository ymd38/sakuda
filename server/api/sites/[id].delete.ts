import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { getEnv } from '../../config/env'
import { getDb } from '../../db/client'
import { logger } from '../../lib/logger'
import { requireParam, toHttpError } from '../../lib/http'
import { deleteSite } from '../../services/siteService'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  try {
    const deleted = await deleteSite(getDb(), id, { scansDir: getEnv().scansDir, logger })
    if (!deleted) throw createError({ statusCode: 404, statusMessage: 'site not found' })
    setResponseStatus(event, 204)
    return null
  } catch (e) {
    toHttpError(e)
  }
})
