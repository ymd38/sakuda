import { defineEventHandler } from 'h3'
import { getDb } from '../db/client'
import { listActiveJobs } from '../services/activeJobs'

export default defineEventHandler(() => listActiveJobs(getDb()))
