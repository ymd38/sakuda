import type { Logger } from '../lib/logger'
import type { SiteWithHeaders } from '../services/siteService'
import type { DiscoveredUrl, Engine, Severity, SeverityCounts } from '#shared/types/api'
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
}

export interface EngineOutput {
  findings: NewFinding[]
  counts: SeverityCounts
  meta: Record<string, unknown>
  warnings: string[]
  exitCode: number | null
  signal: string | null
  /** True when the runner decided, before doing any work, that it must not
   * run (e.g. dalfox when active checks are off). The scan runner records the
   * engine run as `skipped` rather than `done`, so a deliberate no-op is not
   * mistaken for a clean run that found nothing. */
  skipped?: boolean
}

export type EngineRunner = (input: EngineInput) => Promise<EngineOutput>

/** Input to a discovery (crawl-only) run — see `services/discoveryRunner`. */
export interface DiscoverInput {
  discoveryId: string
  site: SiteWithHeaders
  workDir: string
  env: Env
  logger: Logger
  signal: AbortSignal
}

export interface DiscoverOutput {
  urls: DiscoveredUrl[]
  meta: Record<string, unknown>
  warnings: string[]
  exitCode: number | null
  signal: string | null
}

export type DiscoverRunner = (input: DiscoverInput) => Promise<DiscoverOutput>

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
