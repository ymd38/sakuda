import { createError, defineEventHandler } from 'h3'
import { getDb } from '../../db/client'
import { requireParam } from '../../lib/http'
import { getScanDetail } from '../../services/reportService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const detail = getScanDetail(getDb(), id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'scan not found' })
  return detail
})
