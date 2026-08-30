import { z } from 'zod'
import { ENGINES } from '../utils/engines'

export const CreateScanBodySchema = z
  .object({ engines: z.array(z.enum(ENGINES)).min(1) })
  .transform((b) => ({ engines: [...new Set(b.engines)] }))
