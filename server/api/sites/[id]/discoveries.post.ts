import { randomUUID } from 'node:crypto'
import { defineEventHandler, setResponseStatus } from 'h3'
import { getDb } from '../../../db/client'
import { requireParam, toHttpError } from '../../../lib/http'
import { createDiscovery } from '../../../services/discoveryService'

export default defineEventHandler((event) => {
  const siteId = requireParam(event, 'id')
  try {
    const discovery = createDiscovery(getDb(), { now: () => new Date(), id: randomUUID }, siteId)
    setResponseStatus(event, 202)
    return discovery
  } catch (e) {
    toHttpError(e)
  }
})
