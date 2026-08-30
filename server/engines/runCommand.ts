import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import type { Logger } from '../lib/logger'

/**
 * Options for {@link runCommand}. `shell` is intentionally not an option:
 * targets/args may originate from user input (site URLs, scan configs), and
 * shell interpolation would turn that into command injection.
 */
export interface RunCommandOptions {
  label: string
  cmd: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  stdoutPath: string
  stderrPath: string
  timeoutMs: number
  /** Grace period between SIGTERM and SIGKILL when terminating the process group. Default 5000ms. */
  killGraceMs?: number
  signal?: AbortSignal
  logger: Logger
}

export interface CommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  oomKilled: boolean
  durationMs: number
}

export class SpawnError extends Error {}

/** Thrown when capturing stdout/stderr to disk fails (e.g. disk full, permission denied). */
export class OutputStreamError extends Error {}

/**
 * Spawns `cmd` with `args` (never through a shell), captures stdout/stderr to
 * files (never buffered in memory — avoids the 1MB maxBuffer limit of
 * exec/execFile, which is far too small for tools like ZAP), and enforces a
 * hard timeout by killing the whole process group.
 *
 * The child is spawned `detached: true` so it becomes its own process group
 * leader; on timeout/abort we signal the group (`process.kill(-pid, sig)`)
 * rather than just the child, so grandchildren (e.g. ZAP's JVM spawning a
 * Firefox browser) are cleaned up too instead of being orphaned.
 */
export async function runCommand(opts: RunCommandOptions): Promise<CommandResult> {
  const { label, logger, killGraceMs = 5000 } = opts
  const startedAt = Date.now()

  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  const out = createWriteStream(opts.stdoutPath)
  const err = createWriteStream(opts.stderrPath)
  child.stdout.pipe(out)
  child.stderr.pipe(err)

  // Captured, never discarded: a write failure (disk full, permission
  // denied) must surface as OutputStreamError below, not as a normal-looking
  // result with silently truncated output files.
  let streamError: Error | undefined
  const recordStreamError =
    (stream: 'stdout' | 'stderr') =>
    (e: Error): void => {
      streamError ??= e
      logger.error({ label, stream, err: e }, 'output stream failed')
    }
  // Registered now, not after awaiting exit: pipe() can already have ended
  // and finished these streams by the time the child's 'close' event fires,
  // so a listener attached later would miss the event and hang forever.
  // `once()` special-cases 'error': it rejects if the stream errors before
  // 'finish', which is exactly the failure this is meant to catch — the
  // `.catch` below only prevents an unhandled rejection while we still hold
  // the raw promise; it does not discard the error.
  const outFinished = once(out, 'finish').catch(recordStreamError('stdout'))
  const errFinished = once(err, 'finish').catch(recordStreamError('stderr'))

  let timedOut = false
  let aborted = false

  const killGroup = (sig: NodeJS.Signals): void => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, sig)
    } catch (e) {
      // as: no runtime type guard exists for ErrnoException; ESRCH means the
      // group is already gone, which is the expected outcome of killing it.
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e
    }
  }

  const terminate = (reason: string): void => {
    logger.warn({ label, pid: child.pid, reason }, 'terminating process group')
    killGroup('SIGTERM')
    setTimeout(() => killGroup('SIGKILL'), killGraceMs).unref()
  }

  const timer = setTimeout(() => {
    timedOut = true
    terminate(`timeout after ${opts.timeoutMs}ms`)
  }, opts.timeoutMs)

  const onAbort = (): void => {
    aborted = true
    terminate('aborted')
  }
  if (opts.signal?.aborted) onAbort()
  else opts.signal?.addEventListener('abort', onAbort, { once: true })

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', (e) => {
        // Spawn failed: nothing will ever end these writables via pipe(), so
        // destroy them explicitly to avoid leaking open file descriptors.
        out.destroy()
        err.destroy()
        reject(new SpawnError(`${label}: failed to spawn ${opts.cmd}: ${e.message}`, { cause: e }))
      })
      child.once('close', (code, signal) => resolve({ code, signal }))
    },
  )

  const clearWatchers = (): void => {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  // Cleared as soon as the child actually exits (resolve or reject), not
  // after also waiting on the output streams below — otherwise a child that
  // exits promptly but whose output is still flushing to disk can let the
  // timeout timer fire afterwards and mark a clean run as `timedOut: true`.
  // The `finally` below is kept as a safety net (idempotent: clearing an
  // already-cleared timer / removing an already-removed listener is a no-op).
  void exit.then(clearWatchers, clearWatchers)

  try {
    const { code, signal } = await exit
    await Promise.all([outFinished, errFinished])
    if (streamError) {
      throw new OutputStreamError(`${label}: failed to capture process output`, {
        cause: streamError,
      })
    }
    const oomKilled = signal === 'SIGKILL' || code === 137
    const result: CommandResult = {
      code,
      signal,
      timedOut,
      aborted,
      oomKilled,
      durationMs: Date.now() - startedAt,
    }
    logger.info({ label, ...result }, 'process exited')
    return result
  } finally {
    clearWatchers()
  }
}
