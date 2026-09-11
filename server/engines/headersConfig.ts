import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Header } from '#shared/schemas/headers'

/** The `-config` key a tool reads its header list from — goflags maps a
 * config key to the flag's long name: `header` for nuclei and httpx
 * (`-H, -header`), `headers` for katana (`-H, -headers`). */
export type HeadersConfigKey = 'header' | 'headers'

/**
 * The document nuclei, katana and httpx accept via `-config <file>` (#95).
 * All three load it with goflags' YAML config merge, and JSON is YAML, so
 * `JSON.stringify` does every bit of escaping — a Cookie value with quotes,
 * colons or `#` needs no hand-rolled YAML. Verified 2026-09-10 against
 * nuclei 3.x, httpx 1.10/1.12 and katana 1.7.0 with an echo server.
 */
export function headersConfigJson(headers: Header[], key: HeadersConfigKey): string {
  return JSON.stringify({ [key]: headers.map((h) => `${h.name}: ${h.value}`) })
}

/**
 * Runs `fn` with the site's headers written to `path` (0600) for the
 * duration of the call, and removes the file afterwards — success, throw
 * or abort alike. With no headers, `fn` gets `null` and nothing is written,
 * so the tool receives no `-config` at all.
 *
 * This is what keeps Cookie / Authorization values off the child's argv,
 * where `ps` and `/proc/<pid>/cmdline` would show them for as long as the
 * scan runs; the file is readable by the sakuda user only and lives only
 * as long as the run.
 */
export async function withHeadersConfig<T>(
  path: string,
  headers: Header[],
  key: HeadersConfigKey,
  fn: (headersConfigFile: string | null) => Promise<T>,
): Promise<T> {
  if (headers.length === 0) return fn(null)
  await mkdir(dirname(path), { recursive: true })
  // `mode` applies only when the file is created: a stale `headers.json`
  // (a run of this id that died before its `finally`, or a file someone else
  // planted here) would keep its own permissions under a plain write. Remove
  // whatever is there, then create exclusively, so the file the tool reads
  // is always one this process created, always 0600.
  await rm(path, { force: true })
  await writeFile(path, headersConfigJson(headers, key), { mode: 0o600, flag: 'wx' })
  try {
    return await fn(path)
  } finally {
    await rm(path, { force: true })
  }
}

/** `-config <file>` when there is a headers file, nothing otherwise. */
export function headersConfigArgs(headersConfigFile: string | null): string[] {
  return headersConfigFile ? ['-config', headersConfigFile] : []
}
