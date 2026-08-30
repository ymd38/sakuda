import { z } from 'zod'
import { emptyCounts, isReportedSeverity } from '#shared/utils/severity'
import type { SeverityCounts, SeverityLevel } from '#shared/types/api'
import type { NewFinding } from '../types'
import { EngineError } from '../types'

const Instance = z.looseObject({
  uri: z.string().optional(),
  method: z.string().optional(),
  param: z.string().optional(),
  attack: z.string().optional(),
  evidence: z.string().optional(),
  otherinfo: z.string().optional(),
})

const Alert = z.looseObject({
  pluginid: z.string().optional(),
  alertRef: z.string().optional(),
  alert: z.string().optional(),
  name: z.string().optional(),
  riskcode: z.string().optional(),
  confidence: z.string().optional(),
  riskdesc: z.string().optional(),
  desc: z.string().optional(),
  solution: z.string().optional(),
  reference: z.string().optional(),
  cweid: z.string().optional(),
  instances: z.array(Instance).default([]),
})

export const ZapReportSchema = z.looseObject({
  '@version': z.string().optional(),
  '@generated': z.string().optional(),
  site: z.array(
    z.looseObject({ '@name': z.string().optional(), alerts: z.array(Alert).default([]) }),
  ),
})

export type ZapReport = z.infer<typeof ZapReportSchema>
export type ZapAlert = z.infer<typeof Alert>

export function parseZapReport(text: string): ZapReport {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (cause) {
    throw new EngineError('ZAP report is not valid JSON', undefined, { cause })
  }
  const r = ZapReportSchema.safeParse(json)
  if (!r.success) throw new EngineError('unexpected ZAP JSON shape (no "site" array)')
  return r.data
}

export function zapRiskToLevel(riskcode: string | undefined): SeverityLevel {
  return riskcode === '3' ? 'high' : riskcode === '2' ? 'medium' : riskcode === '1' ? 'low' : 'info'
}

export function stripHtml(s: string | undefined): string {
  return (s ?? '')
    .replace(/<\/p>\s*<p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export interface ZapNormalized {
  findings: NewFinding[]
  counts: SeverityCounts
  alertCounts: SeverityCounts
  reachedUrls: string[]
  authFailureCount: number
  zapVersion: string | null
  totalAlerts: number
}

export function normalizeZapReport(
  report: ZapReport,
  engine: 'zap-api' | 'zap-fe',
  unalias: (u: string) => string,
): ZapNormalized {
  const alerts = report.site.flatMap((s) => s.alerts)
  const counts = emptyCounts()
  const alertCounts = emptyCounts()
  const findings: NewFinding[] = []
  const reached = new Set<string>()
  let authFailureCount = 0

  for (const a of alerts) {
    const level = zapRiskToLevel(a.riskcode)
    alertCounts[level]++
    const ruleId = a.alertRef ?? a.pluginid ?? 'unknown'
    const name = a.name ?? a.alert ?? ruleId
    for (const inst of a.instances) {
      counts[level]++
      if (inst.uri) reached.add(unalias(inst.uri))
      if (/^(401|403)\b/.test(inst.evidence ?? '')) authFailureCount++
      if (!isReportedSeverity(level)) continue
      findings.push({
        engine,
        ruleId,
        name,
        severity: level,
        url: unalias(inst.uri ?? ''),
        method: inst.method ?? null,
        param: inst.param || null,
        evidence: inst.evidence || null,
        description: stripHtml(a.desc) || null,
        solution: stripHtml(a.solution) || null,
        reference: stripHtml(a.reference) || null,
        raw: {
          pluginid: a.pluginid,
          cweid: a.cweid,
          confidence: a.confidence,
          riskdesc: a.riskdesc,
          attack: inst.attack,
          otherinfo: inst.otherinfo,
        },
      })
    }
  }

  return {
    findings,
    counts,
    alertCounts,
    reachedUrls: [...reached].sort(),
    authFailureCount,
    zapVersion: report['@version'] ?? null,
    totalAlerts: alerts.length,
  }
}
