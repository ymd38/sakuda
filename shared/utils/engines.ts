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
