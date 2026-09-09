import type { Engine } from '../types/api'

export const ENGINES = ['nuclei', 'zap-api', 'zap-fe'] as const
export const ENGINE_LABELS: Record<Engine, string> = {
  nuclei: 'Nuclei',
  'zap-api': 'ZAP API (active)',
  'zap-fe': 'ZAP Frontend (baseline)',
}
export function isEngine(v: unknown): v is Engine {
  return typeof v === 'string' && (ENGINES as readonly string[]).includes(v)
}

/** The order the scan runner executes engines in — the short API scan
 * first, the crawl second, nuclei last — and the order the page lists them. */
export const ENGINE_ORDER: readonly Engine[] = ['zap-api', 'zap-fe', 'nuclei']
export function orderEngines(engines: readonly Engine[]): Engine[] {
  return ENGINE_ORDER.filter((x) => engines.includes(x))
}
