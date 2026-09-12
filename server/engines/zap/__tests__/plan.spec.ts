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
      seedUrls: ['http://h:3000/'],
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
          // postForm pinned off (default plan = no active checks): the AF
          // spider would otherwise submit forms as POST by default.
          parameters: { context: 'sakuda', url: 'http://h:3000/', maxDuration: 5, postForm: false },
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
      seedUrls: ['http://h:3000/'],
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
    // The FE scan keeps that rule on (no policyDefinition) — it is the whole
    // point of scanning a frontend.
    expect(on[3]).toEqual({
      type: 'activeScan',
      parameters: {
        context: 'sakuda',
        maxScanDurationInMins: 45,
        maxAlertsPerRule: 20,
        threadPerHost: 1,
      },
    })
    expect(on[3]).not.toHaveProperty('policyDefinition')

    // Off: the same jobs minus the activeScan job (the spider's postForm also
    // flips off — asserted in the postForm test below).
    expect(jobsOf(buildZapFePlan(base)).map((j) => j.type)).toEqual(
      on.filter((j) => j.type !== 'activeScan').map((j) => j.type),
    )
  })

  it('gates spider form submission (postForm) on active checks', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrls: ['http://h:3000/'],
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    const spiderOf = (plan: Record<string, unknown>) =>
      (plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>).find(
        (j) => j.type === 'spider',
      )
    // Passive: postForm off (the AF spider would POST forms by default).
    expect(spiderOf(buildZapFePlan(base))?.parameters.postForm).toBe(false)
    // Active: postForm on so forms are submitted as POST.
    expect(
      spiderOf(buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 } }))?.parameters
        .postForm,
    ).toBe(true)
  })

  it('requests the saved targets (GET) after the Ajax spider and before the active scan', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrls: ['http://h:3000/'],
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
        requestTargets: [
          { url: 'http://h:3000/search?q=1', method: 'GET' },
          { url: 'http://h:3000/create', method: 'POST' },
        ],
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
    // `requests` is a sibling of `parameters`; each carries its own method.
    expect(withTargets[3]).toEqual({
      type: 'requestor',
      parameters: {},
      requests: [
        { url: 'http://h:3000/search?q=1', method: 'GET' },
        { url: 'http://h:3000/create', method: 'POST' },
      ],
    })

    // No targets (absent or empty): the plan is the one without the job, job for job.
    const without = withTargets.filter((j) => j.type !== 'requestor')
    expect(jobsOf(buildZapFePlan({ ...base, activeScan: { maxScanMinutes: 45 } }))).toEqual(without)
    expect(
      jobsOf(buildZapFePlan({ ...base, requestTargets: [], activeScan: { maxScanMinutes: 45 } })),
    ).toEqual(without)
  })

  it('runs the site-tree dump script (add + run) right after the spiders, before the requestor', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrls: ['http://h:3000/'],
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    }
    const jobsOf = (plan: Record<string, unknown>) =>
      plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>
    const dump = {
      file: '/zap/wrk/dump-site-tree.js',
      name: 'sakuda-dump-site-tree',
      engine: 'ECMAScript : Graal.js',
    }

    const withDump = jobsOf(
      buildZapFePlan({
        ...base,
        siteTreeDump: dump,
        requestTargets: [{ url: 'http://h:3000/search?q=1', method: 'GET' }],
        activeScan: { maxScanMinutes: 45 },
      }),
    )
    expect(withDump.map((j) => j.type)).toEqual([
      'passiveScan-config',
      'spider',
      'spiderAjax',
      'script',
      'script',
      'requestor',
      'activeScan',
      'passiveScan-wait',
      'report',
      'report',
    ])
    expect(withDump[3]?.parameters).toEqual({
      action: 'add',
      type: 'standalone',
      engine: 'ECMAScript : Graal.js',
      name: 'sakuda-dump-site-tree',
      file: '/zap/wrk/dump-site-tree.js',
    })
    expect(withDump[4]?.parameters).toEqual({
      action: 'run',
      type: 'standalone',
      name: 'sakuda-dump-site-tree',
    })

    // Absent: the plan is the one without the two script jobs, job for job.
    expect(
      jobsOf(
        buildZapFePlan({
          ...base,
          requestTargets: [{ url: 'http://h:3000/search?q=1', method: 'GET' }],
          activeScan: { maxScanMinutes: 45 },
        }),
      ),
    ).toEqual(withDump.filter((j) => j.type !== 'script'))
  })

  it('adds the DOM XSS probe script (add + run) after the active scan when domXssProbe is set', () => {
    const base = {
      context: { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] },
      seedUrls: ['http://h:3000/'],
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
      openapiSources: [{ apiFile: '/zap/wrk/openapi.json' }],
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
          // `policyDefinition` is a sibling of `parameters`; only the DOM XSS
          // rule is off (a per-rule threshold, not `defaultThreshold`, which
          // would silence every rule).
          policyDefinition: { rules: [{ id: 40026, threshold: 'Off' }] },
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
      openapiSources: [{ apiUrl: 'http://h:3000/api/openapi.json' }],
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

  it('emits one openapi job per source (user doc + generated doc) before the active scan', () => {
    const plan = buildZapApiPlan({
      context,
      openapiSources: [
        { apiFile: '/zap/wrk/openapi.json' },
        { apiFile: '/zap/wrk/generated-openapi-0.json' },
      ],
      targetUrl: 'http://h:3000/api/',
      maxScanMinutes: 10,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })
    const jobs = plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>
    const openapiJobs = jobs.filter((j) => j.type === 'openapi')
    expect(openapiJobs.map((j) => j.parameters.apiFile)).toEqual([
      '/zap/wrk/openapi.json',
      '/zap/wrk/generated-openapi-0.json',
    ])
    // both imports come before the single active scan
    expect(jobs.findIndex((j) => j.type === 'activeScan')).toBeGreaterThan(
      jobs.map((j) => j.type).lastIndexOf('openapi'),
    )
  })
  it('frontend plan with several crawl starts: traditional spider from the first, one Ajax spider per seed', () => {
    const plan = buildZapFePlan({
      context: {
        name: 'sakuda',
        urls: ['http://h:3000/'],
        includePaths: ['^http://h:3000(/.*)?$'],
        excludePaths: [],
      },
      seedUrls: ['http://h:3000/#/', 'http://h:3000/#/basket'],
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })
    const jobs = (plan as { jobs: Array<{ type: string; parameters: Record<string, unknown> }> })
      .jobs
    expect(jobs.filter((j) => j.type === 'spider').map((j) => j.parameters.url)).toEqual([
      'http://h:3000/#/',
    ])
    expect(jobs.filter((j) => j.type === 'spiderAjax').map((j) => j.parameters.url)).toEqual([
      'http://h:3000/#/',
      'http://h:3000/#/basket',
    ])
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
          // postForm pinned off — passive discovery must not POST forms (the
          // AF spider defaults it to true).
          parameters: { context: 'sakuda', url: 'http://h:3000/', maxDuration: 3, postForm: false },
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

  it('gates discovery spider form submission (postForm) on active discovery', () => {
    const context = { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] }
    const base = {
      context,
      seedUrls: ['http://h:3000/'],
      spiderMaxMinutes: 3,
      ajaxMaxMinutes: 3,
      scriptFile: '/w/d.js',
      scriptName: 'n',
      scriptEngine: 'ECMAScript : Graal.js',
    }
    const spiderOf = (plan: Record<string, unknown>) =>
      (plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>).find(
        (j) => j.type === 'spider',
      )
    expect(spiderOf(buildZapDiscoverPlan(base))?.parameters.postForm).toBe(false)
    expect(spiderOf(buildZapDiscoverPlan({ ...base, postForms: true }))?.parameters.postForm).toBe(
      true,
    )
  })

  it('adds one Client Spider (spiderClient, scopeCheck Strict) per seed only when clientSpider is on', () => {
    const context = { name: 'sakuda', urls: ['http://h:3000/'], includePaths: [], excludePaths: [] }
    const base = {
      context,
      seedUrls: ['http://h:3000/#/', 'http://h:3000/#/login'],
      spiderMaxMinutes: 4,
      ajaxMaxMinutes: 4,
      scriptFile: '/w/d.js',
      scriptName: 'n',
      scriptEngine: 'ECMAScript : Graal.js',
    }
    const clientJobs = (plan: Record<string, unknown>) =>
      (plan.jobs as Array<{ type: string; parameters: Record<string, unknown> }>).filter(
        (j) => j.type === 'spiderClient',
      )
    // Off (default) → no spiderClient jobs, so the plan matches the passive one.
    expect(clientJobs(buildZapDiscoverPlan(base))).toEqual([])
    // On → one per seed, bounded by spiderMaxMinutes, kept in-context.
    expect(clientJobs(buildZapDiscoverPlan({ ...base, clientSpider: true }))).toEqual([
      {
        type: 'spiderClient',
        parameters: {
          context: 'sakuda',
          url: 'http://h:3000/#/',
          maxDuration: 4,
          numberOfBrowsers: 1,
          browserId: 'firefox-headless',
          scopeCheck: 'Strict',
        },
      },
      {
        type: 'spiderClient',
        parameters: {
          context: 'sakuda',
          url: 'http://h:3000/#/login',
          maxDuration: 4,
          numberOfBrowsers: 1,
          browserId: 'firefox-headless',
          scopeCheck: 'Strict',
        },
      },
    ])
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
      seedUrls: ['http://h:3000/'],
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
      seedUrls: ['http://h:3000/'],
      spiderMaxMinutes: 5,
      ajaxMaxMinutes: 5,
      passiveMaxMinutes: 5,
      reportDir: '/zap/wrk/',
    })

    expect(YAML.parse(planToYaml(plan))).toEqual(plan)
  })
})
