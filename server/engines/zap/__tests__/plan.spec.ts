import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { buildZapApiPlan, buildZapDiscoverPlan, buildZapFePlan, planToYaml } from '../plan'

describe('buildZapFePlan', () => {
  it('builds the Automation Framework plan for a ZAP FE spider+ajax scan', () => {
    const plan = buildZapFePlan({
      context: {
        name: 'sakuda',
        urls: ['http://h:3000/'],
        includePaths: ['^http://h:3000(/.*)?$'],
        excludePaths: ['^https?://[^/]+/auth/logout(\\?.*)?$'],
      },
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })

    expect(plan).toEqual({
      env: {
        contexts: [
          {
            name: 'sakuda',
            urls: ['http://h:3000/'],
            includePaths: ['^http://h:3000(/.*)?$'],
            excludePaths: ['^https?://[^/]+/auth/logout(\\?.*)?$'],
          },
        ],
        parameters: { failOnError: false, failOnWarning: false, progressToStdout: true },
      },
      jobs: [
        { type: 'passiveScan-config', parameters: { enableTags: false, maxAlertsPerRule: 10 } },
        {
          type: 'spider',
          parameters: { context: 'sakuda', url: 'http://h:3000/', maxDuration: 5 },
        },
        {
          type: 'spiderAjax',
          parameters: {
            context: 'sakuda',
            url: 'http://h:3000/',
            maxDuration: 5,
            numberOfBrowsers: 1,
            browserId: 'firefox-headless',
          },
        },
        { type: 'passiveScan-wait', parameters: { maxDuration: 5 } },
        {
          type: 'report',
          parameters: {
            template: 'traditional-json',
            reportDir: '/zap/wrk/',
            reportFile: 'report.json',
          },
        },
        {
          type: 'report',
          parameters: {
            template: 'traditional-html',
            reportDir: '/zap/wrk/',
            reportFile: 'report.html',
          },
        },
      ],
    })
  })
})

describe('buildZapApiPlan', () => {
  const context = {
    name: 'sakuda',
    urls: ['http://h:3000/api/'],
    includePaths: ['^http://h:3000/api(/.*)?$'],
    excludePaths: [],
  }

  it('builds the Automation Framework plan for an openapi apiFile scan', () => {
    const plan = buildZapApiPlan({
      context,
      openapi: { apiFile: '/zap/wrk/openapi.json' },
      targetUrl: 'http://h:3000/api/',
      maxScanMinutes: 10,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })

    expect(plan).toEqual({
      env: {
        contexts: [context],
        parameters: { failOnError: false, failOnWarning: false, progressToStdout: true },
      },
      jobs: [
        { type: 'passiveScan-config', parameters: { enableTags: false, maxAlertsPerRule: 10 } },
        {
          type: 'openapi',
          parameters: {
            apiFile: '/zap/wrk/openapi.json',
            targetUrl: 'http://h:3000/api/',
            context: 'sakuda',
          },
        },
        {
          type: 'activeScan',
          parameters: { context: 'sakuda', maxScanDurationInMins: 10, maxAlertsPerRule: 20 },
        },
        { type: 'passiveScan-wait', parameters: { maxDuration: 5 } },
        {
          type: 'report',
          parameters: {
            template: 'traditional-json',
            reportDir: '/zap/wrk/',
            reportFile: 'report.json',
          },
        },
        {
          type: 'report',
          parameters: {
            template: 'traditional-html',
            reportDir: '/zap/wrk/',
            reportFile: 'report.html',
          },
        },
      ],
    })
  })

  it('supports an apiUrl openapi source instead of apiFile', () => {
    const plan = buildZapApiPlan({
      context,
      openapi: { apiUrl: 'http://h:3000/api/openapi.json' },
      targetUrl: 'http://h:3000/api/',
      maxScanMinutes: 10,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })

    // as: buildZapApiPlan returns Record<string, unknown>; narrow jobs shape for this assertion only
    const openapiJob = plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>
    expect(openapiJob[1]).toEqual({
      type: 'openapi',
      parameters: {
        apiUrl: 'http://h:3000/api/openapi.json',
        targetUrl: 'http://h:3000/api/',
        context: 'sakuda',
      },
    })
  })
})

describe('buildZapDiscoverPlan', () => {
  it('builds a crawl-only plan: passive rules off, both spiders, script add + run, no report', () => {
    const context = {
      name: 'sakuda',
      urls: ['http://h:3000/'],
      includePaths: ['^http://h:3000(/.*)?$'],
      excludePaths: [],
    }
    const plan = buildZapDiscoverPlan({
      context,
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 3,
      ajaxMaxMinutes: 3,
      scriptFile: '/zap/wrk/dump-site-tree.js',
      scriptName: 'sakuda-dump-site-tree',
      scriptEngine: 'ECMAScript : Graal.js',
    })

    expect(plan).toEqual({
      env: {
        contexts: [context],
        parameters: { failOnError: false, failOnWarning: false, progressToStdout: true },
      },
      jobs: [
        { type: 'passiveScan-config', parameters: { disableAllRules: true } },
        {
          type: 'spider',
          parameters: { context: 'sakuda', url: 'http://h:3000/', maxDuration: 3 },
        },
        {
          type: 'spiderAjax',
          parameters: {
            context: 'sakuda',
            url: 'http://h:3000/',
            maxDuration: 3,
            numberOfBrowsers: 1,
            browserId: 'firefox-headless',
          },
        },
        {
          type: 'script',
          parameters: {
            action: 'add',
            type: 'standalone',
            engine: 'ECMAScript : Graal.js',
            name: 'sakuda-dump-site-tree',
            file: '/zap/wrk/dump-site-tree.js',
          },
        },
        {
          type: 'script',
          parameters: { action: 'run', type: 'standalone', name: 'sakuda-dump-site-tree' },
        },
      ],
    })
  })
})

describe('planToYaml', () => {
  it('round-trips a plan through YAML.stringify/YAML.parse', () => {
    const plan = buildZapFePlan({
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })

    expect(YAML.parse(planToYaml(plan))).toEqual(plan)
  })
})
