import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { OutputStreamError, runCommand, SpawnError } from '../runCommand'

describe('runCommand', () => {
  let tmp: string
  let base: {
    label: string
    cmd: string
    cwd: string
    stdoutPath: string
    stderrPath: string
    logger: pino.Logger
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sakuda-'))
    base = {
      label: 't',
      cmd: process.execPath,
      cwd: tmp,
      stdoutPath: join(tmp, 'stdout.log'),
      stderrPath: join(tmp, 'stderr.log'),
      logger: pino({ level: 'silent' }),
    }
  })

  it('captures exit code and streams stdout larger than 1MB to file', async () => {
    const r = await runCommand({
      ...base,
      args: ['-e', "process.stdout.write('x'.repeat(3*1024*1024)); process.exitCode = 3"],
      timeoutMs: 10_000,
    })
    expect(r.code).toBe(3)
    expect(r.signal).toBeNull()
    expect(r.timedOut).toBe(false)
    expect(statSync(base.stdoutPath).size).toBe(3 * 1024 * 1024)
  }, 15_000)

  it('kills the whole process group on timeout (grandchild dies)', async () => {
    const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);process.stdout.write(String(c.pid)+'\\n');setInterval(()=>{},1000)`
    const r = await runCommand({
      ...base,
      args: ['-e', script],
      timeoutMs: 500,
      killGraceMs: 200,
    })
    expect(r.timedOut).toBe(true)
    expect(r.signal === 'SIGTERM' || r.signal === 'SIGKILL').toBe(true)
    const grandchildPid = Number(readFileSync(base.stdoutPath, 'utf8').trim())
    await new Promise((res) => setTimeout(res, 600))
    expect(() => process.kill(grandchildPid, 0)).toThrow(/ESRCH/)
  }, 10_000)

  it('reports SIGKILL as oomKilled', async () => {
    const r = await runCommand({
      ...base,
      args: ['-e', "process.kill(process.pid,'SIGKILL')"],
      timeoutMs: 5000,
    })
    expect(r.signal).toBe('SIGKILL')
    expect(r.oomKilled).toBe(true)
    expect(r.timedOut).toBe(false)
  }, 10_000)

  it('aborts via AbortSignal', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 200)
    const r = await runCommand({
      ...base,
      args: ['-e', 'setInterval(()=>{},1000)'],
      timeoutMs: 10_000,
      signal: ac.signal,
    })
    expect(r.aborted).toBe(true)
  }, 15_000)

  it('rejects with SpawnError when the binary does not exist', async () => {
    await expect(
      runCommand({ ...base, cmd: '/nonexistent/bin', args: [], timeoutMs: 1000 }),
    ).rejects.toThrow(SpawnError)
  })

  it('passes arguments literally (no shell expansion)', async () => {
    await runCommand({
      ...base,
      args: ['-e', 'process.stdout.write(process.argv[1])', '$HOME;`id`'],
      timeoutMs: 5000,
    })
    expect(readFileSync(base.stdoutPath, 'utf8')).toBe('$HOME;`id`')
  }, 10_000)

  it('rejects with OutputStreamError when the output stream fails, after the child exits', async () => {
    // Awaiting the promise here already proves the child exited: runCommand
    // only reaches the OutputStreamError throw after `await exit` (the
    // child's 'close' event) has resolved — structurally, not by inference.
    const brokenStdoutPath = join(tmp, 'missing-dir', 'stdout.log')
    await expect(
      runCommand({
        ...base,
        stdoutPath: brokenStdoutPath,
        args: ['-e', 'process.exitCode = 0'],
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(OutputStreamError)
  }, 10_000)

  it('does not report timedOut for a fast exit while output is still flushing', async () => {
    const r = await runCommand({
      ...base,
      args: ['-e', "process.stdout.write('x'.repeat(2*1024*1024)); process.exitCode = 0"],
      timeoutMs: 10_000,
    })
    expect(r.timedOut).toBe(false)
    expect(r.code).toBe(0)
  }, 15_000)
})
