import { createError, defineEventHandler } from 'h3'
import { getDb } from '../../db/client'
import { requireParam } from '../../lib/http'
import { getDiscovery } from '../../services/discoveryService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const detail = getDiscovery(getDb(), id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'discovery not found' })
  return detail
})
