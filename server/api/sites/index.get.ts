import { defineEventHandler } from 'h3'
import { getDb } from '../../db/client'
import { listSites } from '../../services/siteService'

export default defineEventHandler(() => listSites(getDb()))
