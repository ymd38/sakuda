import type { BrowserStorageName } from '../schemas/browserStorage'

export type Engine = 'nuclei' | 'zap-api' | 'zap-fe'
export const RISK_TAGS = ['dos', 'fuzz', 'intrusive'] as const
export type RiskTag = (typeof RISK_TAGS)[number]
export type Severity = 'critical' | 'high' | 'medium'
export type SeverityLevel = Severity | 'low' | 'info'
export interface SeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
  info: number
}
export type ScanStatus = 'queued' | 'running' | 'done' | 'failed'
export type EngineRunStatus = 'running' | 'done' | 'failed'
export interface SitePublic {
  id: string
  name: string
  frontBaseUrl: string
  apiBaseUrl: string | null
  nucleiPaths: string
  openapiUrl: string | null
  openapiJson: string | null
  zapFeSeedPath: string
  discoverySeedPaths: string
  excludePaths: string
  nucleiRateLimit: number
  zapApiMaxMinutes: number
  zapFeSpiderMaxMinutes: number
  nonLocalConfirmed: boolean
  /** Opt-in for active injection checks; effective only with ownership established. */
  allowMutatingRequests: boolean
  /** nuclei risk-template groups the user opted this site into; effective only
   * with active checks on (see server/domain/activeScan). */
  nucleiEnabledRiskTags: RiskTag[]
  headerNames: string[]
  /** kind + name of each injected browser-storage item; values are write-only. */
  browserStorageNames: BrowserStorageName[]
  requiresConfirmation: boolean
  createdAt: string
  updatedAt: string
}
export type SiteSnapshot = Omit<SitePublic, 'openapiJson' | 'createdAt' | 'updatedAt'> & {
  hasOpenapiJson: boolean
}
export interface ScanSummary {
  id: string
  siteId: string
  status: ScanStatus
  engines: Engine[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  counts: SeverityCounts
}
export interface SiteListItem extends SitePublic {
  lastScan: ScanSummary | null
}
export interface EngineRunView {
  id: string
  engine: Engine
  status: EngineRunStatus
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  signal: string | null
  counts: SeverityCounts
  meta: Record<string, unknown>
  warnings: string[]
  error: string | null
}
export interface FindingView {
  id: string
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
  fingerprint: string
  isNew: boolean
}
export interface ScanDiff {
  previousScanId: string
  newCount: number
  persistingCount: number
  resolved: FindingView[]
}
export interface ScanDetail extends ScanSummary {
  siteName: string
  siteSnapshot: SiteSnapshot
  engineRuns: EngineRunView[]
  findings: FindingView[]
  diff: ScanDiff | null
}
export interface HistoryPoint {
  scanId: string
  createdAt: string
  finishedAt: string | null
  status: ScanStatus
  counts: SeverityCounts
  engines: Partial<Record<Engine, SeverityCounts>>
  diff: { new: number; persisting: number; resolved: number } | null
}
/** One URL found by a discovery crawl, after normalization (same origin,
 * fragment stripped, assets/noise/excluded paths removed). */
export interface DiscoveredUrl {
  url: string
  method: string
  statusCode: number
  /** Which ZAP crawler first reached it. */
  source: 'spider' | 'ajax' | 'other'
}
export type DiscoveryStatus = ScanStatus
export interface DiscoverySummary {
  id: string
  siteId: string
  status: DiscoveryStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  urlCount: number
}
export interface DiscoveryDetail extends DiscoverySummary {
  urls: DiscoveredUrl[]
  meta: Record<string, unknown>
  warnings: string[]
}
export interface AddTargetsResult {
  site: SitePublic
  added: string[]
  skipped: string[]
}
/** One running or queued job, across all sites. Returned by `GET /api/jobs`
 * in the job loop's claim order (running first, then queued scans oldest-first,
 * then queued discoveries oldest-first) — display order = execution order. */
export interface JobView {
  kind: 'scan' | 'discovery'
  status: 'running' | 'queued'
  id: string
  siteId: string
  siteName: string
  createdAt: string
  startedAt: string | null
  /** Only for scans. */
  engines?: Engine[]
}
export interface ApiErrorData {
  code?: string
  issues?: string[]
}
