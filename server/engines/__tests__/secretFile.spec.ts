import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { writeSecretFile } from '../secretFile'

describe('writeSecretFile', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-secret-file-'))
  })

  it('creates the file 0600 with the given content', async () => {
    const path = join(tmp, 'headers.json')
    await writeSecretFile(path, '{"header":["Cookie: a=b"]}')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toBe('{"header":["Cookie: a=b"]}')
  })

  it('replaces a pre-existing 0644 file with a 0600 one holding the new content', async () => {
    const path = join(tmp, 'openapi-0.json')
    writeFileSync(path, '{"stale":true}', { mode: 0o644 })
    expect(statSync(path).mode & 0o777).toBe(0o644)
    await writeSecretFile(path, '{"fresh":true}')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toBe('{"fresh":true}')
  })

  it('creates the parent directory when it is missing', async () => {
    const path = join(tmp, 'work', 'httpx', 'targets.txt')
    expect(existsSync(join(tmp, 'work'))).toBe(false)
    await writeSecretFile(path, 'http://127.0.0.1/\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toBe('http://127.0.0.1/\n')
  })

  it('accepts an empty body, for pre-creating a tool-written output file', async () => {
    const path = join(tmp, 'stdout.jsonl')
    await writeSecretFile(path, '')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toBe('')
  })
})
