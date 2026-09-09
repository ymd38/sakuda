import { createError, defineEventHandler } from 'h3'
import { getEnv } from '../../config/env'
import { getDb } from '../../db/client'
import { timeBudgetEnv } from '../../domain/engineTimeBudget'
import { requireParam } from '../../lib/http'
import { getScanDetail } from '../../services/reportService'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const detail = getScanDetail(getDb(), id, {
    env: timeBudgetEnv(getEnv()),
    now: () => new Date(),
  })
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'scan not found' })
  return detail
})
