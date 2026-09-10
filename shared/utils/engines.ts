import type { Engine } from '../types/api'

export const ENGINES = ['nuclei', 'zap-api', 'zap-fe', 'dalfox'] as const
export const ENGINE_LABELS: Record<Engine, string> = {
  nuclei: 'Nuclei',
  'zap-api': 'ZAP API (active)',
  'zap-fe': 'ZAP Frontend (baseline)',
  dalfox: 'Dalfox (XSS)',
}
export function isEngine(v: unknown): v is Engine {
  return typeof v === 'string' && (ENGINES as readonly string[]).includes(v)
}

/** The order the scan runner executes engines in — the short API scan
 * first, the crawl second, the bounded XSS pass third, nuclei last — and the
 * order the page lists them. dalfox runs after zap-fe (so the crawl's reached
 * URLs are already saved) and before nuclei. */
export const ENGINE_ORDER: readonly Engine[] = ['zap-api', 'zap-fe', 'dalfox', 'nuclei']
export function orderEngines(engines: readonly Engine[]): Engine[] {
  return ENGINE_ORDER.filter((x) => engines.includes(x))
}
