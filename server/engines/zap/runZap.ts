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
  /** Non-secret ZAP config values, passed as `-config key=value` (e.g. the
   * Selenium add-on's Firefox prefs). Keys are ZAP config paths. Secret
   * values must go through `replacerConf` / `secretFiles` instead — argv is
   * visible to every process in the container. */
  config?: Record<string, string>
  /** Non-secret files to drop into `workDir` before the run (e.g. a script
   * the plan references). Keys are file names relative to `workDir`. */
  extraFiles?: Record<string, string>
  /** Files that carry secret values (e.g. the browser-storage Selenium
   * script): written 0600 next to `replacer.conf` and removed in `finally`
   * no matter how the run ends. */
  secretFiles?: Record<string, string>
  /** File (relative to `workDir`) to read back after the run; defaults to the JSON report. */
  reportFile?: string
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
  // ZAP's default home ($HOME/.ZAP) is process-wide and persistent: it writes
  // the -configfile replacer values into config.xml (and echoes them to
  // zap.log) on its own, independent of our replacer.conf cleanup — verified
  // against the built image (grep "test=1" /home/zap/.ZAP/{config.xml,zap.log}
  // both matched after a scan with a Cookie header). Giving each run its own
  // disposable home under workDir means that state dies with the scan instead
  // of leaking into the next one.
  const zapHomeDir = join(i.workDir, 'zaphome')
  await mkdir(zapHomeDir, { recursive: true })
  try {
    await writeFile(planFile, i.planYaml)
    for (const [name, content] of Object.entries(i.extraFiles ?? {}))
      await writeFile(join(i.workDir, name), content)
    for (const [name, content] of Object.entries(i.secretFiles ?? {}))
      await writeFile(join(i.workDir, name), content, { mode: 0o600 })
    const args = ['-dir', zapPath(i.env, i.workDir, 'zaphome'), '-cmd']
    for (const [key, value] of Object.entries(i.config ?? {}))
      args.push('-config', `${key}=${value}`)
    if (i.replacerConf !== null) {
      // Header values must never be readable by anyone but this process: 0600,
      // and removed in `finally` below regardless of how the run ends. Both
      // writes live inside this `try` so a mid-write failure (ENOSPC, EINTR)
      // or a throw before spawning still hits the `finally` cleanup.
      await writeFile(confFile, i.replacerConf, { mode: 0o600 })
      args.push('-configfile', zapPath(i.env, i.workDir, 'replacer.conf'))
    }
    args.push('-autorun', zapPath(i.env, i.workDir, 'plan.yaml'))
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
    const reportJsonPath = join(i.workDir, i.reportFile ?? ZAP_REPORT_JSON)
    const reportText = existsSync(reportJsonPath) ? await readFile(reportJsonPath, 'utf8') : null
    return { result, reportJsonPath, reportText }
  } finally {
    // Header values must not stay on disk: replacer.conf is the file we
    // write ourselves, and zaphome is ZAP's own $HOME (config.xml/zap.log),
    // which independently persists the same replacer values (see comment
    // above) if left in place.
    await rm(confFile, { force: true })
    for (const name of Object.keys(i.secretFiles ?? {}))
      await rm(join(i.workDir, name), { force: true })
    await rm(zapHomeDir, { recursive: true, force: true })
  }
}
