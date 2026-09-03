import YAML from 'yaml'

export interface ZapContext {
  name: string
  urls: string[]
  includePaths: string[]
  excludePaths: string[]
}

/** A ZAP "selenium" script (`browserLaunched` hook) registered and enabled
 * before any browser-driven job, so the Ajax spider starts logged in. */
export interface ZapBrowserScript {
  /** Container-side path (see `zapPath`). */
  file: string
  name: string
  engine: string
}

export interface ZapFePlanInput {
  context: ZapContext
  seedUrl: string
  browserScript?: ZapBrowserScript
  spiderMaxMinutes: number
  ajaxMaxMinutes: number
  passiveMaxMinutes: number
  /** Present only when the site opted into active checks (see
   * `domain/activeScan`): adds an `activeScan` job after the crawl so ZAP's
   * XSS rules (reflected / DOM) run against what the spiders found. */
  activeScan?: { maxScanMinutes: number }
  /** Saved targets to GET once the spiders are done (AF `requestor`), so
   * URLs the crawl never reached still sit in the site tree for the passive
   * and active scans. Empty or absent → no requestor job. */
  requestUrls?: string[]
  /** Standalone DOM XSS probe script (see `domXssProbeScript`) for SPA hash
   * routes, run after the active scan. Absent → no probe jobs. */
  domXssProbe?: ZapStandaloneScript
  reportDir: string
}

/** A ZAP "standalone" script registered and run by a `script` add/run job
 * pair (see `standaloneScriptJobs`). */
export interface ZapStandaloneScript {
  /** Container-side path (see `zapPath`). */
  file: string
  name: string
  engine: string
}

export interface ZapApiPlanInput {
  context: ZapContext
  openapi: { apiFile: string } | { apiUrl: string }
  targetUrl: string
  maxScanMinutes: number
  passiveMaxMinutes: number
  reportDir: string
}

export interface ZapDiscoverPlanInput {
  context: ZapContext
  /** The traditional spider starts from the first seed; the Ajax spider runs once per seed. */
  seedUrls: string[]
  browserScript?: ZapBrowserScript
  spiderMaxMinutes: number
  ajaxMaxMinutes: number
  /** Container-side path of the site-tree dump script (see `siteTreeDump.ts`). */
  scriptFile: string
  scriptName: string
  scriptEngine: string
}

export const ZAP_REPORT_JSON = 'report.json'
export const ZAP_REPORT_HTML = 'report.html'

const envFor = (context: ZapContext) => ({
  contexts: [context],
  parameters: { failOnError: false, failOnWarning: false, progressToStdout: true },
})

const browserScriptJobs = (s: ZapBrowserScript | undefined) =>
  s
    ? [
        {
          type: 'script',
          parameters: {
            action: 'add',
            type: 'selenium',
            engine: s.engine,
            name: s.name,
            file: s.file,
          },
        },
        { type: 'script', parameters: { action: 'enable', type: 'selenium', name: s.name } },
      ]
    : []

const ajaxSpiderJob = (contextName: string, url: string, maxDuration: number) => ({
  type: 'spiderAjax',
  parameters: {
    context: contextName,
    url,
    maxDuration,
    numberOfBrowsers: 1,
    browserId: 'firefox-headless',
  },
})

/** `script` add + run job pair for a standalone script. */
const standaloneScriptJobs = (s: ZapStandaloneScript) => [
  {
    type: 'script',
    parameters: {
      action: 'add',
      type: 'standalone',
      engine: s.engine,
      name: s.name,
      file: s.file,
    },
  },
  { type: 'script', parameters: { action: 'run', type: 'standalone', name: s.name } },
]

/** GET each URL once. `requests` is a sibling of `parameters` in the AF
 * requestor job, like `policyDefinition` for activeScan. */
const requestorJob = (urls: string[]) => ({
  type: 'requestor',
  parameters: {},
  requests: urls.map((url) => ({ url, method: 'GET' })),
})

/** Default policy, hard-capped by `maxScanDurationInMins`. */
const activeScanJob = (
  contextName: string,
  maxScanMinutes: number,
  extra: Record<string, unknown> = {},
) => ({
  type: 'activeScan',
  parameters: {
    context: contextName,
    maxScanDurationInMins: maxScanMinutes,
    maxAlertsPerRule: 20,
    ...extra,
  },
})

/** The FE active scan runs the DOM XSS rule, which opens one headless
 * Firefox per scan thread: ZAP's default (2 × CPU cores) OOM-killed a 4 GB
 * container within minutes, so it is pinned to one browser — the same budget
 * the Ajax spider gets (`numberOfBrowsers: 1`). Its runtime is unpredictable,
 * hence the hard cap. */
const FE_ACTIVE_SCAN_PARAMS = { threadPerHost: 1 }

const reportJobs = (reportDir: string) => [
  {
    type: 'report',
    parameters: { template: 'traditional-json', reportDir, reportFile: ZAP_REPORT_JSON },
  },
  {
    type: 'report',
    parameters: { template: 'traditional-html', reportDir, reportFile: ZAP_REPORT_HTML },
  },
]

export function buildZapFePlan(i: ZapFePlanInput): Record<string, unknown> {
  return {
    env: envFor(i.context),
    jobs: [
      { type: 'passiveScan-config', parameters: { enableTags: false, maxAlertsPerRule: 10 } },
      ...browserScriptJobs(i.browserScript),
      {
        type: 'spider',
        parameters: { context: i.context.name, url: i.seedUrl, maxDuration: i.spiderMaxMinutes },
      },
      ajaxSpiderJob(i.context.name, i.seedUrl, i.ajaxMaxMinutes),
      ...(i.requestUrls?.length ? [requestorJob(i.requestUrls)] : []),
      ...(i.activeScan
        ? [activeScanJob(i.context.name, i.activeScan.maxScanMinutes, FE_ACTIVE_SCAN_PARAMS)]
        : []),
      ...(i.domXssProbe ? standaloneScriptJobs(i.domXssProbe) : []),
      { type: 'passiveScan-wait', parameters: { maxDuration: i.passiveMaxMinutes } },
      ...reportJobs(i.reportDir),
    ],
  }
}

/** Crawl-only plan: spider + Ajax spider, every passive rule disabled (no
 * alerts wanted, and it keeps the run cheap), then a standalone script job
 * that dumps the site tree. No report job — the dump *is* the output. */
export function buildZapDiscoverPlan(i: ZapDiscoverPlanInput): Record<string, unknown> {
  return {
    env: envFor(i.context),
    jobs: [
      { type: 'passiveScan-config', parameters: { disableAllRules: true } },
      ...browserScriptJobs(i.browserScript),
      {
        type: 'spider',
        parameters: {
          context: i.context.name,
          url: i.seedUrls[0],
          maxDuration: i.spiderMaxMinutes,
        },
      },
      ...i.seedUrls.map((url) => ajaxSpiderJob(i.context.name, url, i.ajaxMaxMinutes)),
      {
        type: 'script',
        parameters: {
          action: 'add',
          type: 'standalone',
          engine: i.scriptEngine,
          name: i.scriptName,
          file: i.scriptFile,
        },
      },
      { type: 'script', parameters: { action: 'run', type: 'standalone', name: i.scriptName } },
    ],
  }
}

export function buildZapApiPlan(i: ZapApiPlanInput): Record<string, unknown> {
  return {
    env: envFor(i.context),
    jobs: [
      { type: 'passiveScan-config', parameters: { enableTags: false, maxAlertsPerRule: 10 } },
      {
        type: 'openapi',
        parameters: { ...i.openapi, targetUrl: i.targetUrl, context: i.context.name },
      },
      activeScanJob(i.context.name, i.maxScanMinutes),
      { type: 'passiveScan-wait', parameters: { maxDuration: i.passiveMaxMinutes } },
      ...reportJobs(i.reportDir),
    ],
  }
}

export function planToYaml(plan: Record<string, unknown>): string {
  return YAML.stringify(plan)
}
