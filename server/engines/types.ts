import type { Logger } from '../lib/logger'
import type { SiteWithHeaders } from '../services/siteService'
import type { Engine, Severity, SeverityCounts } from '#shared/types/api'
import type { Env } from '../config/env'

export interface NewFinding {
  engine: Engine
  ruleId: string
  name: string
  severity: Severity
  url: string
  method: string | null
  param: string | null
  evidence: string | null
  description: string | null
  solution: string | null
  reference: string | null
  raw: Record<string, unknown>
}

export interface EngineInput {
  scanId: string
  engine: Engine
  site: SiteWithHeaders
  workDir: string
  env: Env
  logger: Logger
  signal: AbortSignal
  /** Absolute URLs reached by an earlier zap-fe run in the same scan, offered
   * as additional targets (currently consumed by nuclei). */
  extraTargets?: string[]
}

export interface EngineOutput {
  findings: NewFinding[]
  counts: SeverityCounts
  meta: Record<string, unknown>
  warnings: string[]
  exitCode: number | null
  signal: string | null
}

export type EngineRunner = (input: EngineInput) => Promise<EngineOutput>

export class EngineError extends Error {
  constructor(
    message: string,
    public readonly runbook?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'EngineError'
  }
}

export const OOM_RUNBOOK =
  'SIGKILL / exit 137 is an out-of-memory kill. Give the container more memory (6-8 GB recommended when the ZAP Ajax spider runs Firefox), lower SAKUDA_ZAP_MAX_HEAP, or start with --shm-size=1g.'
