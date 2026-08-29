import type { Severity, SeverityCounts, SeverityLevel } from '../types/api'

export const SEVERITY_LEVELS: readonly SeverityLevel[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]
export const REPORTED_SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium']

export function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

export function addCounts(a: SeverityCounts, b: SeverityCounts): SeverityCounts {
  return {
    critical: a.critical + b.critical,
    high: a.high + b.high,
    medium: a.medium + b.medium,
    low: a.low + b.low,
    info: a.info + b.info,
  }
}

export function reportedTotal(c: SeverityCounts): number {
  return c.critical + c.high + c.medium
}

export function severityRank(s: string): number {
  const i = SEVERITY_LEVELS.indexOf(s as SeverityLevel)
  return i === -1 ? 99 : i
}

export function sortBySeverity<T extends { severity: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
}

export function isReportedSeverity(s: string): s is Severity {
  return (REPORTED_SEVERITIES as readonly string[]).includes(s)
}
