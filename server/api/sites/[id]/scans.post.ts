import { randomUUID } from 'node:crypto'
import { defineEventHandler, setResponseStatus } from 'h3'
import { getDb } from '../../../db/client'
import { parseBody, requireParam, toHttpError } from '../../../lib/http'
import { createScan } from '../../../services/scanService'
import { CreateScanBodySchema } from '#shared/schemas/scan'

export default defineEventHandler(async (event) => {
  const siteId = requireParam(event, 'id')
  const { engines } = await parseBody(event, CreateScanBodySchema)
  try {
    const scan = createScan(getDb(), { now: () => new Date(), id: randomUUID }, siteId, engines)
    setResponseStatus(event, 202)
    return scan
  } catch (e) {
    toHttpError(e)
  }
})
