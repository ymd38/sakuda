import { z } from 'zod'
import { HeadersSchema } from './headers'
import { siteRequiresConfirmation } from '../utils/localHost'
import { parseNucleiPathLines } from '../utils/nucleiPaths'

/** Upper bound of the saved target list; `addSiteTargets` enforces the same
 * limit so a discovery save can never leave the site un-editable through
 * the form (which validates against this schema). */
export const NUCLEI_PATHS_MAX_CHARS = 20_000

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)
const HttpUrl = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
  .transform((u) => u.replace(/\/+$/, ''))
const OptionalHttpUrl = z.preprocess(emptyToNull, HttpUrl.nullable()).default(null)

export const SiteInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    frontBaseUrl: HttpUrl,
    apiBaseUrl: OptionalHttpUrl,
    nucleiPaths: z.string().max(NUCLEI_PATHS_MAX_CHARS).default(''),
    openapiUrl: OptionalHttpUrl,
    openapiJson: z.preprocess(emptyToNull, z.string().max(5_000_000).nullable()).default(null),
    zapFeSeedPath: z
      .string()
      .regex(/^\/\S*$/, 'must start with "/"')
      .default('/'),
    excludePaths: z.string().max(5_000).default(''),
    nucleiRateLimit: z.number().int().min(1).max(1000).default(50),
    zapApiMaxMinutes: z.number().int().min(1).max(600).default(45),
    zapFeSpiderMaxMinutes: z.number().int().min(1).max(120).default(5),
    nonLocalConfirmed: z.boolean().default(false),
    headers: HeadersSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const parsed = parseNucleiPathLines(v.nucleiPaths)
    for (const e of parsed.errors)
      ctx.addIssue({ code: 'custom', path: ['nucleiPaths'], message: e })
    if (!v.apiBaseUrl && parsed.lines.some((l) => l.base === 'api')) {
      ctx.addIssue({
        code: 'custom',
        path: ['apiBaseUrl'],
        message: 'apiBaseUrl is required because nucleiPaths contains "api:" lines',
      })
    }
    if (v.openapiUrl && v.openapiJson) {
      ctx.addIssue({
        code: 'custom',
        path: ['openapiJson'],
        message: 'set either openapiUrl or openapiJson, not both',
      })
    }
    if (v.openapiJson) {
      // boundary validation: a parse failure becomes a validation issue, not an exception
      try {
        const j: unknown = JSON.parse(v.openapiJson)
        if (typeof j !== 'object' || j === null) throw new Error('not an object')
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['openapiJson'],
          message: 'openapiJson must be a JSON object',
        })
      }
    }
    if (
      siteRequiresConfirmation(v.frontBaseUrl, v.apiBaseUrl, v.openapiUrl) &&
      !v.nonLocalConfirmed
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['nonLocalConfirmed'],
        message:
          'target host is not local: confirm you are authorized to scan it (nonLocalConfirmed)',
      })
    }
  })

export type SiteInput = z.infer<typeof SiteInputSchema>
