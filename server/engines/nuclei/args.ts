import { headersToNucleiArgs } from '../../domain/headerCipher'
import type { Header } from '#shared/schemas/headers'

export interface NucleiArgsInput {
  targetsFile: string
  templatesDir: string
  outputFile: string
  rateLimit: number
  concurrency: number
  tags: string[]
  headers: Header[]
  /** Set only when active checks are enabled (see `domain/activeScan`):
   * loads the DAST (fuzzing) template tree next to the signature templates
   * and passes `-dast`, without which nuclei skips every fuzzing template. */
  dastTemplatesDir?: string
  /** `-exclude-tags` value; defaults to all three risk tags. The caller
   * passes a shorter list only when a site opted a risk group back in
   * (see `domain/activeScan` `riskExcludeTags`). */
  excludeTags?: string[]
}

export const NUCLEI_BASE_TAGS = ['xss', 'injection', 'sqli', 'ssrf', 'lfi', 'exposure', 'misconfig']

/** Risk-template tags nuclei excludes by default; a site can opt individual
 * ones back in under `allowMutatingRequests` (see `domain/activeScan`). */
export const NUCLEI_RISK_EXCLUDE_TAGS = ['dos', 'fuzz', 'intrusive']

export function nucleiTagsFor(hasHeaders: boolean): string[] {
  return hasHeaders ? [...NUCLEI_BASE_TAGS, 'auth-bypass'] : [...NUCLEI_BASE_TAGS]
}

export function buildNucleiArgs(i: NucleiArgsInput): string[] {
  return [
    '-l',
    i.targetsFile,
    '-t',
    i.templatesDir,
    ...(i.dastTemplatesDir ? ['-t', i.dastTemplatesDir] : []),
    '-tags',
    i.tags.join(','),
    '-severity',
    'critical,high,medium',
    '-exclude-tags',
    (i.excludeTags ?? NUCLEI_RISK_EXCLUDE_TAGS).join(','),
    ...(i.dastTemplatesDir ? ['-dast'] : []),
    '-rate-limit',
    String(i.rateLimit),
    '-c',
    String(i.concurrency),
    '-jsonl',
    '-o',
    i.outputFile,
    '-stats-json',
    '-si',
    '5',
    '-duc',
    '-nc',
    '-omit-raw',
    ...headersToNucleiArgs(i.headers),
  ]
}
