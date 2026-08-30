import { z } from 'zod'

export const HeaderSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[^\s:]+$/, 'header name must not contain whitespace or ":"'),
  value: z
    .string()
    .min(1)
    .regex(/^[^\r\n]*$/, 'header value must not contain CR/LF'),
})

export const HeadersSchema = z.array(HeaderSchema).max(20)

export type Header = z.infer<typeof HeaderSchema>
