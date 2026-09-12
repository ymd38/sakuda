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
  /** The crawl starts the site configures (step 4, Crawl — the same list
   * discovery uses): the traditional spider starts from the first, the Ajax
   * spider runs once per seed. Never empty. */
  seedUrls: string[]
  browserScript?: ZapBrowserScript
  spiderMaxMinutes: number
  ajaxMaxMinutes: number
  passiveMaxMinutes: number
  /** Present only when the site opted into active checks (see
   * `domain/activeScan`): adds an `activeScan` job after the crawl so ZAP's
   * XSS rules (reflected / DOM) run against what the spiders found. */
  activeScan?: { maxScanMinutes: number }
  /** Saved targets to request once the spiders are done (AF `requestor`),
   * each with its method, so URLs the crawl never reached still sit in the
   * site tree for the passive and active scans. Non-GET entries are included
   * by the caller only under active checks. Empty or absent → no requestor
   * job. */
  requestTargets?: ZapRequestTarget[]
  /** Standalone DOM XSS probe script (see `domXssProbeScript`) for SPA hash
   * routes, run after the active scan. Absent → no probe jobs. */
  domXssProbe?: ZapStandaloneScript
  /** Site-tree dump script (see `siteTreeDump`), run right after the two
   * spiders — before the requestor, active scan and probe add their own
   * traffic — so the dump is exactly what the spiders reached. Absent → no
   * dump jobs. */
  siteTreeDump?: ZapStandaloneScript
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
  /** One `openapi` import job per source, all into the same context before the
   * active scan: a user's pasted/URL doc and/or sakuda's generated non-GET doc
   * (#73). Must be non-empty. */
  openapiSources: Array<{ apiFile: string } | { apiUrl: string }>
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
  /** Active discovery (Epic #41 PR5): let the traditional spider submit forms
   * as POST. The AF spider defaults `postForm` to true, so this is pinned
   * false unless the site opted into active checks — a passive discovery must
   * not POST forms. `processForm` keeps its default (GET-form discovery). */
  postForms?: boolean
  /** Active discovery (#70): also run ZAP's Client Spider (`spiderClient`,
   * history type 24) once per seed. It drives a real browser and submits SPA
   * forms with Form Handler values — the only crawler that observed Juice
   * Shop's form-driven non-GET requests (research doc §1.2 Run 3). Form
   * submission is mutating, so like `postForms` this is only set when the site
   * opted into active checks. Absent/false → no spiderClient jobs. */
  clientSpider?: boolean
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

/** ZAP Client Spider (`spiderClient`, `client` add-on): a browser-driven
 * crawl that fills and submits SPA forms via the Form Handler add-on, so
 * form-driven non-GET requests land in the site tree (research doc §1.2 Run 3).
 * `scopeCheck: Strict` keeps it inside the context — the Client Spider will
 * otherwise follow off-origin links (Run 3 POSTed to collector.github.com).
 * One browser, matching the Ajax spider's `numberOfBrowsers: 1` OOM budget. */
const clientSpiderJob = (contextName: string, url: string, maxDuration: number) => ({
  type: 'spiderClient',
  parameters: {
    context: contextName,
    url,
    maxDuration,
    numberOfBrowsers: 1,
    browserId: 'firefox-headless',
    scopeCheck: 'Strict',
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

/** A saved target to request into the site tree, with its HTTP method. No
 * body: discovery captures none and none is invented (Epic #41 PR3/PR4). */
export interface ZapRequestTarget {
  url: string
  method: string
}

/** Requests each target once with its own method — the caller only includes a
 * mutating method when the site opted into active checks. `requests` is a
 * sibling of `parameters` in the AF requestor job, like `policyDefinition`
 * for activeScan. */
const requestorJob = (requests: ZapRequestTarget[]) => ({
  type: 'requestor',
  parameters: {},
  requests: requests.map((r) => ({ url: r.url, method: r.method })),
})

/** AF `policyDefinition` for an activeScan job — a sibling of `parameters`,
 * like `requests` on the requestor job. Only per-rule thresholds are used:
 * `defaultThreshold: Off` would silence every rule. */
interface ZapScanPolicy {
  rules: Array<{ id: number; threshold: 'Off' | 'Low' | 'Medium' | 'High' }>
}

/** Default policy unless `policy` is given, hard-capped by `maxScanDurationInMins`. */
const activeScanJob = (
  contextName: string,
  maxScanMinutes: number,
  extra: Record<string, unknown> = {},
  policy?: ZapScanPolicy,
) => ({
  type: 'activeScan',
  parameters: {
    context: contextName,
    maxScanDurationInMins: maxScanMinutes,
    maxAlertsPerRule: 20,
    ...extra,
  },
  ...(policy ? { policyDefinition: policy } : {}),
})

/** ZAP's DOM XSS rule opens one headless Firefox per scan thread — the one
 * active-scan rule that needs a browser. Both active scans below deal with
 * it, each in the way that fits the target (see the two constants). */
const DOM_XSS_RULE_ID = 40026

/** The FE active scan runs the DOM XSS rule, which opens one headless
 * Firefox per scan thread: ZAP's default (2 × CPU cores) OOM-killed a 4 GB
 * container within minutes, so it is pinned to one browser — the same budget
 * the Ajax spider gets (`numberOfBrowsers: 1`). Its runtime is unpredictable,
 * hence the hard cap. */
const FE_ACTIVE_SCAN_PARAMS = { threadPerHost: 1 }

/** The API active scan keeps ZAP's default thread count for speed and drops
 * the DOM XSS rule instead: an API answers JSON, so DOM XSS is not its
 * concern, and with the rule on every thread launched a Firefox — SIGKILL
 * seconds after `Job activeScan started` on a 4 GB / 4 CPU container. */
const API_ACTIVE_SCAN_POLICY: ZapScanPolicy = {
  rules: [{ id: DOM_XSS_RULE_ID, threshold: 'Off' }],
}

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
        parameters: {
          context: i.context.name,
          url: i.seedUrls[0],
          maxDuration: i.spiderMaxMinutes,
          // ZAP's AF spider defaults postForm/processForm to true — i.e. it
          // submits forms as POST by default. That is a mutating action, so
          // it is pinned to the active-checks opt-in here (a passive run must
          // stay read-only). processForm (filling fields, incl. GET forms)
          // keeps its default so GET forms are still discovered.
          postForm: Boolean(i.activeScan),
        },
      },
      ...i.seedUrls.map((url) => ajaxSpiderJob(i.context.name, url, i.ajaxMaxMinutes)),
      ...(i.siteTreeDump ? standaloneScriptJobs(i.siteTreeDump) : []),
      ...(i.requestTargets?.length ? [requestorJob(i.requestTargets)] : []),
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
          // See ZapDiscoverPlanInput.postForms — pinned off unless active
          // discovery is opted in (the AF spider POSTs forms by default).
          postForm: Boolean(i.postForms),
        },
      },
      ...i.seedUrls.map((url) => ajaxSpiderJob(i.context.name, url, i.ajaxMaxMinutes)),
      // Client Spider per seed, active-checks only (see clientSpider) — after
      // the other spiders so its browser-driven form submissions come last.
      ...(i.clientSpider
        ? i.seedUrls.map((url) => clientSpiderJob(i.context.name, url, i.spiderMaxMinutes))
        : []),
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
      ...i.openapiSources.map((source) => ({
        type: 'openapi',
        parameters: { ...source, targetUrl: i.targetUrl, context: i.context.name },
      })),
      activeScanJob(i.context.name, i.maxScanMinutes, {}, API_ACTIVE_SCAN_POLICY),
      { type: 'passiveScan-wait', parameters: { maxDuration: i.passiveMaxMinutes } },
      ...reportJobs(i.reportDir),
    ],
  }
}

export function planToYaml(plan: Record<string, unknown>): string {
  return YAML.stringify(plan)
}
