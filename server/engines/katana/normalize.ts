import { z } from 'zod'

/** One `-jsonl` line from katana. Go's `omitempty` drops `response`
 * entirely when the crawler never requested the URL (a string it only saw
 * in a JS bundle), so `response` is optional here and its absence is a
 * signal, not an error. */
const Line = z.object({
  request: z.object({
    method: z.string().default('GET'),
    endpoint: z.string(),
  }),
  response: z.object({ status_code: z.number().int().optional() }).optional(),
})

export interface KatanaEntry {
  method: string
  url: string
  /** `null` when katana emitted the URL without ever requesting it. */
  status: number | null
}

/** A {@link KatanaEntry} the crawler actually fetched. */
export interface RespondedKatanaEntry extends KatanaEntry {
  status: number
}

export function parseKatanaJsonl(text: string): { entries: KatanaEntry[]; invalidLines: number } {
  const entries: KatanaEntry[] = []
  let invalidLines = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      invalidLines++
      continue
    }
    const r = Line.safeParse(json)
    if (!r.success) {
      invalidLines++
      continue
    }
    entries.push({
      method: r.data.request.method,
      url: r.data.request.endpoint,
      status: r.data.response?.status_code ?? null,
    })
  }
  return { entries, invalidLines }
}

export type KatanaDropReason = 'noResponse' | 'artifact'

/** `%5C%22` is an escaped `\"` — the tail of a string literal that katana's
 * regex matched in minified JS (`/api/%5C%22/`); never a real path. */
const ESCAPED_QUOTE = '%5C%22'

/** katana-specific junk, decided before the shared crawl normalization
 * (origin / assets / excludePaths / cap) in `domain/crawledUrls`:
 * - `noResponse`: a string katana scraped from a bundle but never requested
 *   (the `/i.visualViewport.scale/i.document.do` class of regex artifacts —
 *   everything the crawler actually fetched carries a status)
 * - `artifact`: an escaped-quote fragment of a JS string literal */
export function classifyKatanaEntry(e: KatanaEntry): KatanaDropReason | null {
  if (e.status === null) return 'noResponse'
  if (e.url.includes(ESCAPED_QUOTE)) return 'artifact'
  return null
}

export function dropKatanaArtifacts(entries: KatanaEntry[]): {
  kept: RespondedKatanaEntry[]
  dropped: Record<KatanaDropReason, number>
} {
  const dropped: Record<KatanaDropReason, number> = { noResponse: 0, artifact: 0 }
  const kept: RespondedKatanaEntry[] = []
  for (const e of entries) {
    const reason = classifyKatanaEntry(e)
    if (reason) dropped[reason]++
    // `classifyKatanaEntry` returned null, so `status` is a number here.
    else if (e.status !== null) kept.push({ ...e, status: e.status })
  }
  return { kept, dropped }
}
