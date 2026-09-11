import { headersConfigArgs } from '../headersConfig'

export interface KatanaArgsInput {
  /** One seed URL per line (`-list`, like nuclei's `-l`): a URL is never
   * split on a comma the way a `-u a,b` value would be. */
  seedsFile: string
  outputFile: string
  /** `-ct <n>m`: katana stops crawling after this budget on its own; the
   * `runCommand` timeout above it is the hard stop. */
  maxMinutes: number
  /** Path of the 0600 headers config (`engines/headersConfig`), or null
   * when the site has no headers — the values never go on argv (#95). */
  headersConfigFile: string | null
  /** `-cs` regexes (see `domain/crawlScope` `katanaScopeRegexes`); empty
   * when the site sets no crawl scope, so the argv is unchanged. */
  crawlScopeRegexes?: string[]
  /** Active discovery (Epic #41 PR5): add `-aff` (automatic form filling) so
   * katana submits the forms it finds — a mutating action gated on the
   * site's active-checks opt-in (see `domain/activeScan`). Off → the default
   * static crawl, argv unchanged. */
  activeFormFill?: boolean
}

/** Fixed: measured on Juice Shop (2026-09-03) — `-jc` is what finds the API
 * paths in the JS bundles, `-kf all` needs depth ≥ 3 to reach the known files. */
export const KATANA_MAX_DEPTH = 3

/** Static crawl only: no headless browser (ZAP's Ajax spider covers SPA
 * click-through). `-fs fqdn` limits the crawl to the seed's host, so an
 * `apiBaseUrl` on another origin is not followed — ZAP still covers it. A
 * site's crawl scope adds `-cs` regexes on top (katana 1.7.0 applies the
 * host scope and the URL regexes cumulatively). */
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
    ...(i.crawlScopeRegexes ?? []).flatMap((r) => ['-cs', r]),
    ...(i.activeFormFill ? ['-aff'] : []),
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
    ...headersConfigArgs(i.headersConfigFile),
  ]
}
