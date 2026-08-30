import type { ChartConfiguration } from 'chart.js'
import type { Engine, HistoryPoint, Severity } from '#shared/types/api'
import { ENGINES, ENGINE_LABELS } from '#shared/utils/engines'
import { emptyCounts, reportedTotal } from '#shared/utils/severity'

/** Minimum number of history points required before a trend chart is meaningful. */
export const MIN_TREND_POINTS = 2

/** Colors injected into Chart.js configs. Canvas rendering doesn't inherit CSS
 * variables, so the actual color values (resolved by chart-palette.ts on the
 * client, or injected directly in tests) must be passed in rather than
 * referenced by class/token name. */
export interface ChartPalette {
  grid: string
  text: string
  severity: Record<Severity, string>
  engines: Record<Engine, string>
  diff: { new: string; persisting: string; resolved: string }
}

export function hasTrendData(h: readonly HistoryPoint[]): boolean {
  return h.length >= MIN_TREND_POINTS
}

/** `(finishedAt ?? createdAt)` as `YYYY-MM-DD HH:MM`, read directly off the ISO
 * string so the label doesn't shift with the viewer's locale/timezone. */
export function historyLabel(h: HistoryPoint): string {
  const iso = h.finishedAt ?? h.createdAt
  return iso.slice(0, 16).replace('T', ' ')
}

const SEVERITY_KEYS: readonly Severity[] = ['critical', 'high', 'medium']
const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
}

export function buildSeverityStackConfig(
  h: readonly HistoryPoint[],
  p: ChartPalette,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: h.map(historyLabel),
      datasets: SEVERITY_KEYS.map((key) => ({
        label: SEVERITY_LABELS[key],
        data: h.map((point) => point.counts[key]),
        backgroundColor: p.severity[key],
        stack: 'severity',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: p.grid }, ticks: { color: p.text } },
        y: { stacked: true, grid: { color: p.grid }, ticks: { color: p.text } },
      },
      plugins: { legend: { display: true, labels: { color: p.text } } },
    },
  }
}

export function buildEngineCountConfig(
  h: readonly HistoryPoint[],
  p: ChartPalette,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: h.map(historyLabel),
      datasets: ENGINES.map((engine) => ({
        label: ENGINE_LABELS[engine],
        data: h.map((point) => reportedTotal(point.engines[engine] ?? emptyCounts())),
        backgroundColor: p.engines[engine],
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: p.grid }, ticks: { color: p.text } },
        y: { grid: { color: p.grid }, ticks: { color: p.text } },
      },
      plugins: { legend: { display: true, labels: { color: p.text } } },
    },
  }
}

export function buildDiffTrendConfig(
  h: readonly HistoryPoint[],
  p: ChartPalette,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: h.map(historyLabel),
      datasets: [
        {
          label: 'New',
          data: h.map((point) => (point.diff === null ? null : point.diff.new)),
          backgroundColor: p.diff.new,
          stack: 'diff',
        },
        {
          label: 'Persisting',
          data: h.map((point) => (point.diff === null ? null : point.diff.persisting)),
          backgroundColor: p.diff.persisting,
          stack: 'diff',
        },
        {
          label: 'Resolved',
          data: h.map((point) => (point.diff === null ? null : -point.diff.resolved)),
          backgroundColor: p.diff.resolved,
          stack: 'diff',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: p.grid }, ticks: { color: p.text } },
        y: { stacked: true, grid: { color: p.grid }, ticks: { color: p.text } },
      },
      plugins: { legend: { display: true, labels: { color: p.text } } },
    },
  }
}
