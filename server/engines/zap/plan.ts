import YAML from 'yaml'

export interface ZapContext {
  name: string
  urls: string[]
  includePaths: string[]
  excludePaths: string[]
}

export interface ZapFePlanInput {
  context: ZapContext
  seedUrl: string
  spiderMaxMinutes: number
  ajaxMaxMinutes: number
  passiveMaxMinutes: number
  reportDir: string
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
  seedUrl: string
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
      {
        type: 'spider',
        parameters: { context: i.context.name, url: i.seedUrl, maxDuration: i.spiderMaxMinutes },
      },
      {
        type: 'spiderAjax',
        parameters: {
          context: i.context.name,
          url: i.seedUrl,
          maxDuration: i.ajaxMaxMinutes,
          numberOfBrowsers: 1,
          browserId: 'firefox-headless',
        },
      },
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
      {
        type: 'spider',
        parameters: { context: i.context.name, url: i.seedUrl, maxDuration: i.spiderMaxMinutes },
      },
      {
        type: 'spiderAjax',
        parameters: {
          context: i.context.name,
          url: i.seedUrl,
          maxDuration: i.ajaxMaxMinutes,
          numberOfBrowsers: 1,
          browserId: 'firefox-headless',
        },
      },
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
      {
        type: 'activeScan',
        parameters: {
          context: i.context.name,
          maxScanDurationInMins: i.maxScanMinutes,
          maxAlertsPerRule: 20,
        },
      },
      { type: 'passiveScan-wait', parameters: { maxDuration: i.passiveMaxMinutes } },
      ...reportJobs(i.reportDir),
    ],
  }
}

export function planToYaml(plan: Record<string, unknown>): string {
  return YAML.stringify(plan)
}
