import { describe, expect, it } from 'vitest'
import { annotateTargets, isPrunableStatus, parseHttpxJsonl } from '../normalize'

const line = (o: Record<string, unknown>) => JSON.stringify(o)

describe('parseHttpxJsonl', () => {
  it('reads input / status_code / failed / error and nothing else', () => {
    const text = [
      line({ input: 'http://h/a', url: 'http://h/a', status_code: 200, failed: false, title: 'x' }),
      line({ input: 'http://h/b', status_code: 0, failed: true, error: 'connection refused' }),
    ].join('\n')
    expect(parseHttpxJsonl(text)).toEqual({
      observations: [
        { input: 'http://h/a', statusCode: 200, failed: false, error: null },
        { input: 'http://h/b', statusCode: null, failed: true, error: 'connection refused' },
      ],
      invalidLines: 0,
    })
  })

  it('counts unparsable lines and lines without an input, keeps the rest', () => {
    const text = [
      'not json',
      line({ url: 'http://h/x', status_code: 200 }),
      '',
      line({ input: 'http://h/a', status_code: 404 }),
    ].join('\n')
    const r = parseHttpxJsonl(text)
    expect(r.invalidLines).toBe(2)
    expect(r.observations).toEqual([
      { input: 'http://h/a', statusCode: 404, failed: false, error: null },
    ])
  })
})

describe('isPrunableStatus', () => {
  it('allows 4xx except 405 and 429; never 2xx/3xx/5xx', () => {
    expect(isPrunableStatus(404)).toBe(true)
    expect(isPrunableStatus(410)).toBe(true)
    expect(isPrunableStatus(405)).toBe(false)
    expect(isPrunableStatus(429)).toBe(false)
    expect(isPrunableStatus(200)).toBe(false)
    expect(isPrunableStatus(302)).toBe(false)
    expect(isPrunableStatus(500)).toBe(false)
    expect(isPrunableStatus(503)).toBe(false)
  })
})

describe('annotateTargets', () => {
  const inputs = [
    'http://h/ok',
    'http://h/gone',
    'http://h/down',
    'http://h/silent',
    'http://h/busy',
  ]
  const observations = [
    { input: 'http://h/ok', statusCode: 200, failed: false, error: null },
    { input: 'http://h/gone', statusCode: 404, failed: false, error: null },
    { input: 'http://h/down', statusCode: null, failed: true, error: 'connection refused' },
    // no line for /silent
    { input: 'http://h/busy', statusCode: 503, failed: false, error: null },
  ]

  it('by default keeps every target, including a 404, and only annotates', () => {
    const a = annotateTargets(inputs, observations, [])
    expect(a.kept).toEqual(inputs)
    expect(a.dropped).toEqual([])
    expect(a).toMatchObject({
      observedCount: 4,
      unobservedCount: 1,
      failedCount: 1,
      statusCounts: { '200': 1, '404': 1, '503': 1 },
    })
  })

  it('with the opt-in drops only a target httpx positively observed on the list; unknown stays', () => {
    const a = annotateTargets(inputs, observations, [404, 410])
    expect(a.dropped).toEqual(['http://h/gone'])
    expect(a.kept).toEqual(['http://h/ok', 'http://h/down', 'http://h/silent', 'http://h/busy'])
  })

  it('never drops on an unprunable status even when it is on the list', () => {
    const a = annotateTargets(inputs, observations, [503, 405, 429])
    expect(a.dropped).toEqual([])
    expect(a.kept).toEqual(inputs)
  })

  it('a transport failure with a status is still unknown, not evidence', () => {
    const a = annotateTargets(
      ['http://h/x'],
      [{ input: 'http://h/x', statusCode: 404, failed: true, error: 'timeout' }],
      [404],
    )
    expect(a.kept).toEqual(['http://h/x'])
    expect(a.failedCount).toBe(1)
  })

  it('uses the first line per input when httpx repeats one', () => {
    const a = annotateTargets(
      ['http://h/x'],
      [
        { input: 'http://h/x', statusCode: 200, failed: false, error: null },
        { input: 'http://h/x', statusCode: 404, failed: false, error: null },
      ],
      [404],
    )
    expect(a.kept).toEqual(['http://h/x'])
    expect(a.statusCounts).toEqual({ '200': 1 })
  })
})
