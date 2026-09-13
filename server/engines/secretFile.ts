import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Writes a file that holds a secret for the duration of one engine run — a
 * headers `-config`, an OpenAPI doc carrying query values, a tool's
 * pre-created output — so that it is always 0600 and always ours.
 *
 * `writeFile`'s `mode` applies only when the file is created: a stale file
 * at this path (a run of the same id that died before its `finally`, or a
 * file someone else planted here) would keep its own permissions under a
 * plain write. So: remove whatever is there, then create exclusively
 * (`wx`). The file the tool reads is then one this process created, 0600.
 * Callers own the path, its name and its removal (#97).
 */
export async function writeSecretFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await rm(path, { force: true })
  await writeFile(path, content, { mode: 0o600, flag: 'wx' })
}
