import { headersToHeaderArgs } from '../../domain/headerCipher'
import type { Header } from '#shared/schemas/headers'

export interface NucleiArgsInput {
  targetsFile: string
  templatesDir: string
  outputFile: string
  rateLimit: number
  concurrency: number
  tags: string[]
  headers: Header[]
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

/**
 * Args for the signature phase: the `http` template tree against the GET
 * target list, in both passive and active mode. Never `-dast` — nuclei
 * treats that flag as "run DAST templates only", so passing it here would
 * silently drop every signature template (#65); the DAST tree gets its own
 * run via {@link buildNucleiDastArgs}. Active mode only changes the tag
 * lists (risk groups opted back in), which apply to the signature tree too.
 */
export function buildNucleiArgs(i: NucleiArgsInput): string[] {
  return [
    '-l',
    i.targetsFile,
    '-t',
    i.templatesDir,
    '-tags',
    i.tags.join(','),
    '-severity',
    'critical,high,medium',
    '-exclude-tags',
    (i.excludeTags ?? NUCLEI_RISK_EXCLUDE_TAGS).join(','),
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
    ...headersToHeaderArgs(i.headers),
  ]
}

export interface NucleiDastArgsInput {
  targetsFile: string
  /** DAST (fuzzing) template tree only; the signature tree has its own run. */
  dastTemplatesDir: string
  outputFile: string
  rateLimit: number
  concurrency: number
  /** Same lists as the signature phase (risk groups included), so a risk
   * opt-in gates the DAST templates exactly as it did before the split. */
  tags: string[]
  excludeTags: string[]
  headers: Header[]
}

/**
 * Args for the active GET DAST phase (#65): the same target list as the
 * signature phase, but only the DAST tree with `-dast`, which is what makes
 * nuclei execute fuzzing templates at all. Tag filters are shared with the
 * signature phase so the template set equals what the single active run
 * used to execute before the split.
 */
export function buildNucleiDastArgs(i: NucleiDastArgsInput): string[] {
  return [
    '-l',
    i.targetsFile,
    '-t',
    i.dastTemplatesDir,
    '-dast',
    '-tags',
    i.tags.join(','),
    '-severity',
    'critical,high,medium',
    '-exclude-tags',
    i.excludeTags.join(','),
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
    ...headersToHeaderArgs(i.headers),
  ]
}

export interface NucleiOpenapiArgsInput {
  /** The generated OpenAPI document, imported with `-im openapi`. */
  openapiFile: string
  /** DAST (fuzzing) template tree only — the OpenAPI phase is exactly the
   * fuzzing phase, so it never loads the signature `http` tree. */
  dastTemplatesDir: string
  outputFile: string
  rateLimit: number
  concurrency: number
  headers: Header[]
}

/**
 * Args for the non-GET OpenAPI DAST phase (Epic #41 PR3). Unlike
 * {@link buildNucleiArgs} it imports an OpenAPI document (`-im openapi`),
 * loads only the DAST tree, and applies no tag filter — the DAST templates
 * are the whole point of this phase. Same `-omit-raw` / severity / output
 * discipline as the list phase.
 */
export function buildNucleiOpenapiArgs(i: NucleiOpenapiArgsInput): string[] {
  return [
    '-l',
    i.openapiFile,
    '-im',
    'openapi',
    '-t',
    i.dastTemplatesDir,
    '-dast',
    '-severity',
    'critical,high,medium',
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
    ...headersToHeaderArgs(i.headers),
  ]
}
