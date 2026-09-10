import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

export class EnvError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args)
    this.name = 'EnvError'
  }
}

/**
 * `runCommand`/`runZap` spawn with `cwd: <per-scan workDir>`, so Node
 * resolves a relative command containing a path separator (e.g.
 * `./scripts/zap-docker.sh`) against *that* directory, not the process's
 * cwd — it can never be found. Resolve such values against
 * `process.cwd()` at parse time instead. A bare name with no separator
 * (e.g. `zap.sh`, `nuclei`) is left untouched for a `PATH` lookup, and an
 * already-absolute path is left untouched too.
 */
function resolveExecutablePath(value: string): string {
  if (!value.includes('/')) return value
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
}

function isBase64Key32(s: string): boolean {
  const buf = Buffer.from(s, 'base64')
  return buf.length === 32 && buf.toString('base64') === s
}

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
)

const EnvSchema = z.object({
  SAKUDA_ENCRYPTION_KEY: z
    .string({
      error: 'SAKUDA_ENCRYPTION_KEY is required (base64 of 32 random bytes; run `pnpm keygen`)',
    })
    .refine(isBase64Key32, 'SAKUDA_ENCRYPTION_KEY must be canonical base64 of exactly 32 bytes'),
  SAKUDA_DATA_DIR: z.string().default('./data'),
  SAKUDA_MIGRATIONS_DIR: z.string().default('./server/db/migrations'),
  SAKUDA_NUCLEI_BIN: z.string().default('nuclei'),
  SAKUDA_NUCLEI_TEMPLATES: z.string().default('/opt/nuclei-templates/http'),
  // Non-empty: an explicit empty value would make `dastTemplatesDir` falsy and
  // silently drop `-t <dir>`/`-dast`, so an opted-in active scan would revert to
  // passive with no error. Fail fast at startup instead.
  SAKUDA_NUCLEI_DAST_TEMPLATES: z
    .string()
    .trim()
    .min(1, 'SAKUDA_NUCLEI_DAST_TEMPLATES must not be empty')
    .default('/opt/nuclei-templates/dast'),
  SAKUDA_NUCLEI_MAX_MINUTES: z.coerce.number().int().positive().default(60),
  SAKUDA_NUCLEI_CONCURRENCY: z.coerce.number().int().positive().default(25),
  SAKUDA_KATANA_BIN: z.string().default('katana'),
  SAKUDA_DALFOX_BIN: z.string().default('dalfox'),
  SAKUDA_DALFOX_MAX_MINUTES: z.coerce.number().int().positive().default(10),
  // Bounded parallelism for the XSS pass — deliberately small: dalfox is
  // aimed at a curated saved-target list, not a large recon dump.
  SAKUDA_DALFOX_CONCURRENCY: z.coerce.number().int().positive().default(10),
  SAKUDA_DALFOX_MAX_TARGETS: z.coerce.number().int().positive().default(50),
  SAKUDA_ZAP_CMD: z.string().default('zap.sh'),
  SAKUDA_ZAP_WORKDIR: optionalString,
  SAKUDA_ZAP_MAX_HEAP: z
    .string()
    .regex(/^\d+[kKmMgG]?$/)
    .default('1024m'),
  SAKUDA_LOCALHOST_ALIAS: optionalString,
  SAKUDA_ZAP_LOCALHOST_ALIAS: optionalString,
  SAKUDA_ENGINE_GRACE_MINUTES: z.coerce.number().int().nonnegative().default(10),
  SAKUDA_JOB_RUNNER: z.enum(['on', 'off']).default('on'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export interface Env {
  encryptionKey: string
  dataDir: string
  dbFile: string
  scansDir: string
  /** Per-discovery work dirs (ZAP plan/logs/site-tree dump), sibling of `scansDir`. */
  discoveriesDir: string
  migrationsDir: string
  localhostAlias: string | undefined
  nuclei: {
    bin: string
    templatesDir: string
    dastTemplatesDir: string
    maxMinutes: number
    concurrency: number
  }
  /** katana's time budget is the site's `zapFeSpiderMaxMinutes` — no env knob. */
  katana: { bin: string }
  dalfox: {
    bin: string
    maxMinutes: number
    concurrency: number
    maxTargets: number
  }
  zap: {
    cmd: string
    workDir: string | undefined
    maxHeap: string
    localhostAlias: string | undefined
  }
  engineGraceMinutes: number
  jobRunner: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const r = EnvSchema.safeParse(raw)
  if (!r.success)
    throw new EnvError(
      'invalid environment: ' +
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    )
  const v = r.data
  const dataDir = resolve(v.SAKUDA_DATA_DIR)
  return {
    encryptionKey: v.SAKUDA_ENCRYPTION_KEY,
    dataDir,
    dbFile: resolve(dataDir, 'sakuda.db'),
    scansDir: resolve(dataDir, 'scans'),
    discoveriesDir: resolve(dataDir, 'discoveries'),
    migrationsDir: resolve(v.SAKUDA_MIGRATIONS_DIR),
    localhostAlias: v.SAKUDA_LOCALHOST_ALIAS,
    nuclei: {
      bin: resolveExecutablePath(v.SAKUDA_NUCLEI_BIN),
      templatesDir: v.SAKUDA_NUCLEI_TEMPLATES,
      dastTemplatesDir: v.SAKUDA_NUCLEI_DAST_TEMPLATES,
      maxMinutes: v.SAKUDA_NUCLEI_MAX_MINUTES,
      concurrency: v.SAKUDA_NUCLEI_CONCURRENCY,
    },
    katana: { bin: resolveExecutablePath(v.SAKUDA_KATANA_BIN) },
    dalfox: {
      bin: resolveExecutablePath(v.SAKUDA_DALFOX_BIN),
      maxMinutes: v.SAKUDA_DALFOX_MAX_MINUTES,
      concurrency: v.SAKUDA_DALFOX_CONCURRENCY,
      maxTargets: v.SAKUDA_DALFOX_MAX_TARGETS,
    },
    zap: {
      cmd: resolveExecutablePath(v.SAKUDA_ZAP_CMD),
      workDir: v.SAKUDA_ZAP_WORKDIR,
      maxHeap: v.SAKUDA_ZAP_MAX_HEAP,
      localhostAlias: v.SAKUDA_ZAP_LOCALHOST_ALIAS ?? v.SAKUDA_LOCALHOST_ALIAS,
    },
    engineGraceMinutes: v.SAKUDA_ENGINE_GRACE_MINUTES,
    jobRunner: v.SAKUDA_JOB_RUNNER === 'on',
    logLevel: v.LOG_LEVEL,
  }
}

let cached: Env | undefined

export function getEnv(): Env {
  cached ??= parseEnv(process.env)
  return cached
}

export function resetEnvCache(): void {
  cached = undefined
}
