import { z } from 'zod'
import { emptyCounts, isReportedSeverity, SEVERITY_LEVELS } from '#shared/utils/severity'
import type { SeverityCounts, SeverityLevel } from '#shared/types/api'
import type { NewFinding } from '../types'

export const NucleiLineSchema = z.looseObject({
  'template-id': z.string(),
  info: z.looseObject({
    name: z.string().default(''),
    severity: z.string().default('unknown'),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reference: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
  }),
  type: z.string().optional(),
  host: z.string().optional(),
  'matched-at': z.string().optional(),
  'matcher-name': z.string().optional(),
  'extracted-results': z.array(z.string()).optional(),
  request: z.string().optional(),
  response: z.string().optional(),
  timestamp: z.string().optional(),
})
export type NucleiLine = z.infer<typeof NucleiLineSchema>

export interface NucleiStats {
  duration?: string
  errors?: string
  hosts?: string
  matched?: string
  requests?: string
  rps?: string
  templates?: string
  total?: string
}

export function parseNucleiJsonl(text: string): { lines: NucleiLine[]; invalidLines: number } {
  const lines: NucleiLine[] = []
  let invalidLines = 0
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    // boundary: one malformed line must not kill the run — counted and surfaced as a warning
    try {
      const r = NucleiLineSchema.safeParse(JSON.parse(l))
      if (r.success) lines.push(r.data)
      else invalidLines++
    } catch {
      invalidLines++
    }
  }
  return { lines, invalidLines }
}

export function parseNucleiStats(logText: string): NucleiStats | null {
  for (const c of logText
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .reverse()) {
    try {
      const j: unknown = JSON.parse(c)
      // as: shape guarded by the 'requests' in j check above; every NucleiStats field is an
      // optional string, so a partial/malformed object still satisfies the type at runtime.
      if (typeof j === 'object' && j && 'requests' in j) return j as NucleiStats
    } catch {
      /* not a stats line */
    }
  }
  return null
}

export function normalizeNucleiLines(
  lines: NucleiLine[],
  unalias: (u: string) => string,
): { findings: NewFinding[]; counts: SeverityCounts } {
  const counts = emptyCounts()
  const findings: NewFinding[] = []
  for (const l of lines) {
    const sev = l.info.severity.toLowerCase()
    // as: SEVERITY_LEVELS is typed as readonly SeverityLevel[]; widen to string[] so
    // .includes() can check an arbitrary lowercased severity string against it.
    const isKnownLevel = (SEVERITY_LEVELS as readonly string[]).includes(sev)
    // as: narrowed by the includes() check above — sev is one of SEVERITY_LEVELS when true.
    const level: SeverityLevel = isKnownLevel ? (sev as SeverityLevel) : 'info'
    counts[level]++
    if (!isReportedSeverity(level)) continue
    const url = unalias(l['matched-at'] ?? l.host ?? '')
    const method = /^([A-Z]+) \S+ HTTP\//.exec(l.request ?? '')?.[1] ?? null
    const refs =
      l.info.reference == null
        ? null
        : (Array.isArray(l.info.reference) ? l.info.reference : [l.info.reference]).join('\n')
    findings.push({
      engine: 'nuclei',
      ruleId: l['template-id'],
      name: l.info.name,
      severity: level,
      url,
      method,
      param: null,
      evidence: l['extracted-results']?.join(', ') ?? l['matcher-name'] ?? null,
      description: l.info.description?.trim() ?? null,
      solution: null,
      reference: refs,
      // request/response are intentionally NOT stored here: nuclei is run with
      // -omit-raw (see args.ts), but even if that ever changed, these fields
      // can contain the site's injected auth headers (Cookie/Authorization)
      // verbatim and must never be persisted to disk/SQLite in plaintext.
      raw: {
        templateId: l['template-id'],
        type: l.type,
        host: l.host,
        tags: l.info.tags,
        matcherName: l['matcher-name'],
        timestamp: l.timestamp,
      },
    })
  }
  return { findings, counts }
}
