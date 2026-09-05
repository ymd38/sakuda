import { describe, expect, it } from 'vitest'
import { classifyKatanaEntry, dropKatanaArtifacts, parseKatanaJsonl } from '../normalize'

const line = (o: unknown) => JSON.stringify(o)

describe('parseKatanaJsonl', () => {
  it('reads method / endpoint / status and treats a missing response as no status', () => {
    const text = [
      line({
        timestamp: 't',
        request: { method: 'GET', endpoint: 'http://h/api/Feedbacks', source: 'http://h/main.js' },
        response: { status_code: 200, headers: {} },
      }),
      line({
        request: { method: 'POST', endpoint: 'http://h/rest/user/login' },
        response: { status_code: 401 },
      }),
      // Never requested: Go omitempty leaves `response` out entirely.
      line({ request: { endpoint: 'http://h/i.visualViewport.scale/i.document.do' } }),
      // Requested but the response block carries no status.
      line({ request: { endpoint: 'http://h/Mod-/' }, response: { headers: {} } }),
      '',
      'not json',
      line({ request: { method: 'GET' } }),
    ].join('\n')
    const { entries, invalidLines } = parseKatanaJsonl(text)
    expect(entries).toEqual([
      { method: 'GET', url: 'http://h/api/Feedbacks', status: 200 },
      { method: 'POST', url: 'http://h/rest/user/login', status: 401 },
      { method: 'GET', url: 'http://h/i.visualViewport.scale/i.document.do', status: null },
      { method: 'GET', url: 'http://h/Mod-/', status: null },
    ])
    expect(invalidLines).toBe(2)
  })

  it('returns nothing for empty output', () => {
    expect(parseKatanaJsonl('')).toEqual({ entries: [], invalidLines: 0 })
  })
})

describe('classifyKatanaEntry / dropKatanaArtifacts', () => {
  it('drops status-less entries and escaped-quote fragments, keeps real responses', () => {
    expect(classifyKatanaEntry({ method: 'GET', url: 'http://h/a', status: null })).toBe(
      'noResponse',
    )
    expect(classifyKatanaEntry({ method: 'GET', url: 'http://h/api/%5C%22/', status: 404 })).toBe(
      'artifact',
    )
    expect(classifyKatanaEntry({ method: 'GET', url: 'http://h/api/Feedbacks', status: 200 })).toBe(
      null,
    )
    // A 500 is a real endpoint (the server answered); only "never asked" is junk.
    expect(classifyKatanaEntry({ method: 'GET', url: 'http://h/rest/web3', status: 500 })).toBe(
      null,
    )

    const { kept, dropped } = dropKatanaArtifacts([
      { method: 'GET', url: 'http://h/api/Feedbacks', status: 200 },
      { method: 'GET', url: 'http://h/api/%5C%22/', status: 404 },
      { method: 'GET', url: 'http://h/x', status: null },
      { method: 'GET', url: 'http://h/y', status: null },
    ])
    expect(kept).toEqual([{ method: 'GET', url: 'http://h/api/Feedbacks', status: 200 }])
    expect(dropped).toEqual({ noResponse: 2, artifact: 1 })
  })
})
