import { createError, defineEventHandler } from 'h3'
import { getDb } from '../../db/client'
import { requireParam } from '../../lib/http'
import { getSite } from '../../services/siteService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const site = getSite(getDb(), id)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'site not found' })
  return site
})
