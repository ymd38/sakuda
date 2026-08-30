import type {
  EngineRunView,
  FindingView,
  ScanDetail,
  ScanDiff,
  Severity,
  SeverityCounts,
} from '#shared/types/api'
import { addCounts, emptyCounts, REPORTED_SEVERITIES } from '#shared/utils/severity'
import { engineMetaTable } from './markdownEngineMeta'

const MAX_URLS = 60
const MAX_EVIDENCE_CHARS = 120
const MAX_REF_LINES = 3

// ---------- Markdown-safety helpers ----------
// Table cells and code spans must never let a finding/warning field break the
// document structure: a stray backtick would close a code span early, a pipe
// would split a table row, a newline would break out of the current line.
// Exported for markdownEngineMeta.ts, which renders the per-engine metadata
// table with the same safety rules.

/** Wraps a value as inline code, neutralising characters that would break
 * the span itself or a table cell it sits in. */
export function code(s: string | null | undefined): string {
  return '`' + (s ?? '').replace(/[`\r\n]/g, ' ').replace(/\|/g, '\\|') + '`'
}

/** Plain text safe for a Markdown table cell / single line. */
export function text(s: string | null | undefined): string {
  return (s ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')
}

function firstLine(s: string | null | undefined): string {
  return text((s ?? '').split(/\r?\n/)[0])
}

export function fmtDuration(sec: number | undefined): string {
  if (sec === undefined || sec <= 0) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

/** Fences `content` for a code block, escalating the fence marker if the
 * content itself contains a triple-backtick sequence. */
function fence(content: string): string[] {
  const marker = content.includes('```') ? '````' : '```'
  return [marker, content, marker]
}

// ---------- meta narrowing helpers (no `as` casts) ----------
// Exported for markdownEngineMeta.ts to read engine-specific `meta` fields
// without casting the `Record<string, unknown>` the DB layer hands back.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function metaNumber(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key]
  return typeof v === 'number' ? v : undefined
}

export function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key]
  return typeof v === 'string' ? v : undefined
}

export function metaStringArray(meta: Record<string, unknown>, key: string): string[] | undefined {
  const v = meta[key]
  if (!Array.isArray(v)) return undefined
  return v.every((x): x is string => typeof x === 'string') ? v : undefined
}

export function metaRecord(
  meta: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = meta[key]
  return isRecord(v) ? v : undefined
}

export function metaBoolean(meta: Record<string, unknown>, key: string): boolean {
  return meta[key] === true
}

// ---------- top-level sections ----------

export function buildScanMarkdown(detail: ScanDetail): string {
  const date = (detail.finishedAt ?? detail.createdAt).slice(0, 10)
  const lines: string[] = [`# sakuda Scan Report — ${text(detail.siteName)} — ${date}`, '']
  lines.push(...scanMetadataSection(detail), '')
  lines.push(...summarySection(detail), '')
  lines.push(...diffSection(detail.diff), '')
  for (const run of detail.engineRuns) {
    const findings = detail.findings.filter((f) => f.engine === run.engine)
    lines.push(...engineSection(run, findings), '')
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

function scanMetadataSection(detail: ScanDetail): string[] {
  const snap = detail.siteSnapshot
  const durationSec =
    detail.startedAt && detail.finishedAt
      ? Math.round(
          (new Date(detail.finishedAt).getTime() - new Date(detail.startedAt).getTime()) / 1000,
        )
      : undefined
  return [
    '## Scan metadata',
    '',
    '| Item | Value |',
    '|---|---|',
    `| Site | ${text(detail.siteName)} |`,
    `| Front base URL | ${code(snap.frontBaseUrl)} |`,
    `| API base URL | ${snap.apiBaseUrl ? code(snap.apiBaseUrl) : '—'} |`,
    `| Engines | ${text(detail.engines.join(', '))} |`,
    `| Status | ${text(detail.status)} |`,
    `| Started at | ${detail.startedAt ? text(detail.startedAt) : '—'} |`,
    `| Finished at | ${detail.finishedAt ? text(detail.finishedAt) : '—'} |`,
    `| Duration | ${fmtDuration(durationSec)} |`,
    `| Scan id | ${code(detail.id)} |`,
  ]
}

function countsRow(label: string, c: SeverityCounts): string {
  return `| ${label} | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} | ${c.info} |`
}

function summarySection(detail: ScanDetail): string[] {
  const rows = detail.engineRuns.map((run) => countsRow(text(run.engine), run.counts))
  const total = detail.engineRuns.reduce((acc, run) => addCounts(acc, run.counts), emptyCounts())
  return [
    '## Summary',
    '',
    '| Engine | Critical | High | Medium | Low | Info |',
    '|---|---|---|---|---|---|',
    ...rows,
    countsRow('**Total**', total),
  ]
}

function diffSection(diff: ScanDiff | null): string[] {
  const out = ['## Changes vs previous scan', '']
  if (!diff) {
    out.push('No previous scan to compare against.')
    return out
  }
  out.push(
    `New: ${diff.newCount}`,
    `Persisting: ${diff.persistingCount}`,
    `Resolved: ${diff.resolved.length}`,
  )
  if (diff.resolved.length > 0) {
    out.push('')
    for (const f of diff.resolved)
      out.push(`- ${text(f.ruleId)} — ${text(f.name)} — ${code(f.url)}`)
  }
  return out
}

// ---------- per-engine section ----------

function engineSection(run: EngineRunView, findings: FindingView[]): string[] {
  const out = [`## ${run.engine}`, '', `**Status**: ${text(run.status)}`, '']
  out.push(...engineMetaTable(run), '')
  for (const w of run.warnings) out.push(`> Warning: ${text(w)}`)
  if (run.warnings.length > 0) out.push('')
  if (run.status === 'failed') {
    out.push('Status: failed', '')
    out.push(...fence(text(run.error ?? 'unknown error')), '')
  }
  out.push(...findingsBlock(findings))
  if (run.engine === 'zap-fe') out.push(...reachedUrlsBlock(run.meta))
  return out
}

// ---------- findings ----------

function findingsBlock(findings: FindingView[]): string[] {
  const bySeverity = new Map<Severity, FindingView[]>()
  for (const sev of REPORTED_SEVERITIES) bySeverity.set(sev, [])
  for (const f of findings) bySeverity.get(f.severity)?.push(f)

  const any = [...bySeverity.values()].some((v) => v.length > 0)
  if (!any) return ['No findings.', '']

  const out: string[] = []
  for (const sev of REPORTED_SEVERITIES) {
    const items = bySeverity.get(sev)
    if (!items || items.length === 0) continue
    out.push(`### ${sev}`, '')
    for (const f of items) out.push(...findingBlock(f))
  }
  return out
}

function findingBlock(f: FindingView): string[] {
  const marker = f.isNew ? ' **NEW**' : ''
  const out = [`#### ${text(f.ruleId)} — ${text(f.name)}${marker}`, '']
  const method = f.method ? `${f.method} ` : ''
  out.push(`- **URL**: ${code(`${method}${f.url}`)}`)
  if (f.param) out.push(`- **Param**: ${code(f.param)}`)
  if (f.evidence) {
    const truncated = f.evidence.length > MAX_EVIDENCE_CHARS
    const snippet = f.evidence.slice(0, MAX_EVIDENCE_CHARS)
    out.push(`- **Evidence**: ${code(snippet)}${truncated ? '…' : ''}`)
  }
  if (f.description) out.push(`- ${firstLine(f.description)}`)
  if (f.solution) out.push(`- **Solution**: ${firstLine(f.solution)}`)
  if (f.reference) {
    const refs = f.reference
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, MAX_REF_LINES)
    if (refs.length > 0) out.push(`- Refs: ${refs.map((r) => text(r)).join(', ')}`)
  }
  out.push('')
  return out
}

function reachedUrlsBlock(meta: Record<string, unknown>): string[] {
  const urls = metaStringArray(meta, 'reachedUrls') ?? []
  const out = ['### Reached URLs', '']
  if (urls.length === 0) {
    out.push('No URLs reached.', '')
    return out
  }
  for (const u of urls.slice(0, MAX_URLS)) out.push(`- ${code(u)}`)
  if (urls.length > MAX_URLS) out.push(`- … ${urls.length - MAX_URLS} more`)
  out.push('')
  return out
}
