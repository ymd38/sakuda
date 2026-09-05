import { headersToHeaderArgs } from '../../domain/headerCipher'
import type { Header } from '#shared/schemas/headers'

export interface KatanaArgsInput {
  /** One seed URL per line (`-list`, like nuclei's `-l`): a URL is never
   * split on a comma the way a `-u a,b` value would be. */
  seedsFile: string
  outputFile: string
  /** `-ct <n>m`: katana stops crawling after this budget on its own; the
   * `runCommand` timeout above it is the hard stop. */
  maxMinutes: number
  headers: Header[]
}

/** Fixed: measured on Juice Shop (2026-09-03) — `-jc` is what finds the API
 * paths in the JS bundles, `-kf all` needs depth ≥ 3 to reach the known files. */
export const KATANA_MAX_DEPTH = 3

/** Static crawl only: no headless browser (ZAP's Ajax spider covers SPA
 * click-through). `-fs fqdn` limits the crawl to the seed's host, so an
 * `apiBaseUrl` on another origin is not followed — ZAP still covers it. */
export function buildKatanaArgs(i: KatanaArgsInput): string[] {
  return [
    '-list',
    i.seedsFile,
    '-jc',
    '-kf',
    'all',
    '-d',
    String(KATANA_MAX_DEPTH),
    '-fs',
    'fqdn',
    '-ct',
    `${i.maxMinutes}m`,
    '-jsonl',
    '-o',
    i.outputFile,
    '-silent',
    '-nc',
    '-duc',
    // Keep raw requests/responses, bodies and the target's response headers
    // out of urls.jsonl (7.7 MB → 56 KB on Juice Shop; no page content or
    // Set-Cookie values on disk — only method / endpoint / status_code are
    // read). Not `-omit-body`: in katana 1.7.0 that strips the body *before*
    // the JS parser sees it, so `-jc` finds nothing (verified 2026-09-04:
    // 15 vs 209 lines).
    '-eof',
    'raw,body,headers',
    ...headersToHeaderArgs(i.headers),
  ]
}
