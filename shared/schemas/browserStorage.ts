import { z } from 'zod'

/** Where a value is injected into ZAP's browser before the Ajax spider
 * crawls: web storage (what SPAs use for a login token) or a cookie. */
export const BROWSER_STORAGE_KINDS = ['localStorage', 'sessionStorage', 'cookie'] as const
export type BrowserStorageKind = (typeof BROWSER_STORAGE_KINDS)[number]

export const BrowserStorageItemSchema = z
  .object({
    kind: z.enum(BROWSER_STORAGE_KINDS),
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n]*$/, 'name must not contain CR/LF'),
    value: z
      .string()
      .min(1)
      .max(10_000)
      .regex(/^[^\r\n]*$/, 'value must not contain CR/LF'),
  })
  .superRefine((v, ctx) => {
    // Cookie syntax: the name must be a token and the value must not carry
    // a separator, or `document.cookie = name=value` would set something else.
    if (v.kind === 'cookie' && !/^[^\s;=,]+$/.test(v.name))
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'cookie name must not contain whitespace, ";", "=" or ","',
      })
    if (v.kind === 'cookie' && /[;]/.test(v.value))
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'cookie value must not contain ";"',
      })
  })

export const BrowserStorageSchema = z.array(BrowserStorageItemSchema).max(20)

export type BrowserStorageItem = z.infer<typeof BrowserStorageItemSchema>

/** What the API exposes about stored items: never the value. */
export interface BrowserStorageName {
  kind: BrowserStorageKind
  name: string
}
