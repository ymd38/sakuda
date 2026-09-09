import { createError, defineEventHandler, setHeader } from 'h3'
import { getEnv } from '../../../config/env'
import { getDb } from '../../../db/client'
import { timeBudgetEnv } from '../../../domain/engineTimeBudget'
import { buildScanMarkdown } from '../../../domain/markdownReport'
import { requireParam } from '../../../lib/http'
import { getScanDetail } from '../../../services/reportService'

const MAX_SLUG_LENGTH = 40

/** Lowercase, non-alphanumerics collapsed to `-`, leading/trailing `-`
 * trimmed, capped so the resulting filename stays short and filesystem-safe. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
}

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const detail = getScanDetail(getDb(), id, {
    env: timeBudgetEnv(getEnv()),
    now: () => new Date(),
  })
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'scan not found' })
  if (detail.status === 'queued' || detail.status === 'running')
    throw createError({ statusCode: 409, statusMessage: 'scan is not finished' })

  const slug = slugify(detail.siteName) || 'site'
  const filename = `sakuda-${slug}-${detail.id.slice(0, 8)}.md`
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${filename}"`)
  return buildScanMarkdown(detail)
})
