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

  it('inserts an activeScan job between the Ajax spider and passiveScan-wait when active checks are on', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    // as: plans are Record<string, unknown>; narrow the job list for assertions only
    const jobsOf = (plan: Record<string, unknown>) =>
      plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>

    const on = jobsOf(buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 } }))
    expect(on.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'activeScan',
      'passiveScan-wait',
      'report',
      'report',
    ])
    // threadPerHost 1: the DOM XSS rule opens one headless Firefox per scan
    // thread, and ZAP's default (2 × CPU cores) OOM-kills a 4 GB container.
    expect(on[3]).toEqual({
      type: 'activeScan',
      parameters: {
        context: 'sakuda',
        maxScanDurationInMins: 45,
        maxAlertsPerRule: 20,
        threadPerHost: 1,
      },
    })

    // Off: the plan is exactly the default one, job for job.
    expect(jobsOf(buildZapFePlan(base))).toEqual(on.filter((j) => j.type !== 'activeScan'))
  })

  it('requests the saved targets (GET) after the Ajax spider and before the active scan', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    // as: plans are Record<string, unknown>; narrow the job list for assertions only
    const jobsOf = (plan: Record<string, unknown>) =>
      plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>

    const withTargets = jobsOf(
      buildZapFePlan({
        ...base,
        requestUrls: ['http://h:3000/search?q=1', 'http://h:3000/greet?name=1'],
        activeScan: { maxScanMinutes: 45 },
      }),
    )
    expect(withTargets.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'requestor',
      'activeScan',
      'passiveScan-wait',
      'report',
      'report',
    ])
    // `requests` is a sibling of `parameters` in the AF requestor job.
    expect(withTargets[3]).toEqual({
      type: 'requestor',
      parameters: {},
      requests: [
        { url: 'http://h:3000/search?q=1', method: 'GET' },
        { url: 'http://h:3000/greet?name=1', method: 'GET' },
      ],
    })

    // No targets (absent or empty): the plan is the one without the job, job for job.
    const without = withTargets.filter((j) => j.type !== 'requestor')
    expect(jobsOf(buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 } }))).toEqual(without)
    expect(
      jobsOf(buildZapFePlan({ ...base, requestUrls: [], activeScan: { maxScanMinutes: 45 } })),
    ).toEqual(without)
  })

  it('adds the DOM XSS probe script (add + run) after the active scan when domXssProbe is set', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    const jobsOf = (plan: Record<string, unknown>) =>
      plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>

    const probe = {
      file: '/zap/wrk/dom-xss-probe.js',
      name: 'sakuda-dom-xss-probe',
      engine: 'ECMAScript : Graal.js',
    }
    const withProbe = jobsOf(
      buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 }, domXssProbe: probe }),
    )
    expect(withProbe.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'activeScan',
      'script',
      'script',
      'passiveScan-wait',
      'report',
      'report',
    ])
    expect(withProbe[4]).toEqual({
      type: 'script',
      parameters: {
        action: 'add',
        type: 'standalone',
        engine: 'ECMAScript : Graal.js',
        name: 'sakuda-dom-xss-probe',
        file: '/zap/wrk/dom-xss-probe.js',
      },
    })
    expect(withProbe[5]).toEqual({
      type: 'script',
      parameters: { action: 'run', type: 'standalone', name: 'sakuda-dom-xss-probe' },
    })

    // Absent: the plan is the one without the two script jobs, job for job.
    const without = withProbe.filter((j) => j.type !== 'script')
    expect(jobsOf(buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 } }))).toEqual(without)
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
      seedUrls: ['http://h:3000/'],
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

describe('browser-storage script jobs and multiple discovery seeds', () => {
  const context = {
    name: 'sakuda',
    urls: ['http://h:3000/'],
    includePaths: ['^http://h:3000(/.*)?$'],
    excludePaths: [],
  }
  const browserScript = {
    file: '/zap/wrk/browser-storage.js',
    name: 'sakuda-browser-storage',
    engine: 'ECMAScript : Graal.js',
  }
  const seleniumJobs = [
    {
      type: 'script',
      parameters: {
        action: 'add',
        type: 'selenium',
        engine: 'ECMAScript : Graal.js',
        name: 'sakuda-browser-storage',
        file: '/zap/wrk/browser-storage.js',
      },
    },
    {
      type: 'script',
      parameters: { action: 'enable', type: 'selenium', name: 'sakuda-browser-storage' },
    },
  ]
  // as: plans are Record<string, unknown>; narrow the job list for assertions only
  const jobsOf = (plan: Record<string, unknown>) =>
    plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>

  it('discovery: registers + enables the selenium script before any spider, one Ajax spider per seed', () => {
    const plan = buildZapDiscoverPlan({
      context,
      seedUrls: ['http://h:3000/#/', 'http://h:3000/#/basket', 'http://h:3000/profile'],
      browserScript,
      spiderMaxMinutes: 2,
      ajaxMaxMinutes: 2,
      scriptFile: '/zap/wrk/dump-site-tree.js',
      scriptName: 'sakuda-dump-site-tree',
      scriptEngine: 'ECMAScript : Graal.js',
    })
    const jobs = jobsOf(plan)
    expect(jobs.slice(1, 3)).toEqual(seleniumJobs)
    expect(jobs.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'script',
      'script',
      'spider',
      'spiderAjax',
      'spiderAjax',
      'spiderAjax',
      'script',
      'script',
    ])
    expect(jobs[3]?.parameters.url).toBe('http://h:3000/#/')
    expect(jobs.filter((j) => j.type === 'spiderAjax').map((j) => j.parameters.url)).toEqual([
      'http://h:3000/#/',
      'http://h:3000/#/basket',
      'http://h:3000/profile',
    ])
  })

  it('zap-fe: includes the selenium jobs only when a browser script is given', () => {
    const base = {
      context,
      seedUrl: 'http://h:3000/',
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    expect(jobsOf(buildZapFePlan({ ...base, browserScript })).slice(1, 3)).toEqual(seleniumJobs)
    expect(jobsOf(buildZapFePlan(base)).some((j) => j.parameters.type === 'selenium')).toBe(false)
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
