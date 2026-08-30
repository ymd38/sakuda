import { createError, getRouterParam, readBody, type H3Event } from 'h3'
import type { z } from 'zod'
import { ServiceError } from '../services/errors'

export async function parseBody<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
  const r = schema.safeParse(await readBody(event))
  if (!r.success)
    throw createError({
      statusCode: 422,
      statusMessage: 'Validation failed',
      data: {
        code: 'VALIDATION',
        issues: r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`),
      },
    })
  return r.data
}

export function requireParam(event: H3Event, name: string): string {
  const v = getRouterParam(event, name)
  if (!v) throw createError({ statusCode: 400, statusMessage: `missing route param ${name}` })
  return v
}

export function toHttpError(err: unknown): never {
  if (err instanceof ServiceError)
    throw createError({
      statusCode: err.statusCode,
      statusMessage: err.message,
      data: { code: err.code, details: err.details },
    })
  throw err
}
