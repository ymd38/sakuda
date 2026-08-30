import { createError, defineEventHandler } from 'h3'
import { getDb } from '../../../db/client'
import { requireParam } from '../../../lib/http'
import { getSite } from '../../../services/siteService'
import { listScans } from '../../../services/scanService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const db = getDb()
  if (!getSite(db, id)) throw createError({ statusCode: 404, statusMessage: 'site not found' })
  return listScans(db, id)
})
