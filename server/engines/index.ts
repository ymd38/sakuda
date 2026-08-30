import type { Engine } from '#shared/types/api'
import { runNuclei } from './nuclei'
import type { EngineRunner } from './types'
import { runZapApi } from './zap/zapApi'
import { runZapFe } from './zap/zapFe'

export const ENGINE_ORDER: readonly Engine[] = ['zap-api', 'zap-fe', 'nuclei']

export const engineRunners: Record<Engine, EngineRunner> = {
  nuclei: runNuclei,
  'zap-api': runZapApi,
  'zap-fe': runZapFe,
}

/** Sorts and dedupes a scan's requested engines into their fixed run order. */
export function orderEngines(engines: Engine[]): Engine[] {
  return ENGINE_ORDER.filter((x) => engines.includes(x))
}
