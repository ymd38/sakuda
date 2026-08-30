import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { Env } from '../../config/env'
import type { Logger } from '../../lib/logger'
import { runCommand, type CommandResult } from '../runCommand'
import { ZAP_REPORT_JSON } from './plan'

/**
 * `-autorun`/`-configfile` are passed to the `zap.sh` process, which may run
 * inside a container where `env.zap.workDir` is the mount point for
 * `hostWorkDir` — in that case ZAP needs the container-side path, not the
 * host path the caller (and Node's fs calls) use to read/write the files.
 */
export function zapPath(env: Env, hostWorkDir: string, file: string): string {
  return env.zap.workDir ? posix.join(env.zap.workDir, file) : join(hostWorkDir, file)
}

export interface ZapRunInput {
  label: string
  env: Env
  workDir: string
  planYaml: string
  replacerConf: string | null
  timeoutMs: number
  signal: AbortSignal
  logger: Logger
}

export interface ZapRunOutput {
  result: CommandResult
  reportJsonPath: string
  reportText: string | null
}

/**
 * Writes the ZAP Automation Framework plan (and, when headers are
 * configured, a `replacer.conf` add-on config) to `workDir`, runs `zap.sh`
 * against them, and reads back the JSON report it produced (if any).
 */
export async function runZap(i: ZapRunInput): Promise<ZapRunOutput> {
  await mkdir(i.workDir, { recursive: true })
  const planFile = join(i.workDir, 'plan.yaml')
  const confFile = join(i.workDir, 'replacer.conf')
  await writeFile(planFile, i.planYaml)
  const args = ['-cmd']
  if (i.replacerConf !== null) {
    // Header values must never be readable by anyone but this process: 0600,
    // and removed in `finally` below regardless of how the run ends.
    await writeFile(confFile, i.replacerConf, { mode: 0o600 })
    args.push('-configfile', zapPath(i.env, i.workDir, 'replacer.conf'))
  }
  args.push('-autorun', zapPath(i.env, i.workDir, 'plan.yaml'))
  try {
    const result = await runCommand({
      label: i.label,
      cmd: i.env.zap.cmd,
      args,
      cwd: i.workDir,
      env: {
        SAKUDA_ZAP_HOST_WORKDIR: i.workDir,
        JAVA_TOOL_OPTIONS: `-Xmx${i.env.zap.maxHeap}`,
      },
      stdoutPath: join(i.workDir, 'stdout.log'),
      stderrPath: join(i.workDir, 'stderr.log'),
      timeoutMs: i.timeoutMs,
      signal: i.signal,
      logger: i.logger,
    })
    const reportJsonPath = join(i.workDir, ZAP_REPORT_JSON)
    const reportText = existsSync(reportJsonPath) ? await readFile(reportJsonPath, 'utf8') : null
    return { result, reportJsonPath, reportText }
  } finally {
    await rm(confFile, { force: true }) // header values must not stay on disk
  }
}
