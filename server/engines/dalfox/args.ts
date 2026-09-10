export interface DalfoxArgsInput {
  /** File listing one target URL per line (`--input-type file`). */
  targetsFile: string
  /** Path dalfox writes its JSON report to (`-o`). */
  outputFile: string
  /** The 0600 config carrying secrets + the bounded profile (`--config`). */
  configFile: string
}

/**
 * Builds dalfox's argv. Only non-secret, structural flags live here — the
 * target file, JSON output, and the config path; every tunable and every
 * secret is in the config file (see `buildDalfoxConfig`). `scan` is the
 * subcommand; `--silence` keeps logs off stdout so the JSON file is the only
 * result surface, and `--no-color` keeps the report free of ANSI codes.
 */
export function buildDalfoxArgs(i: DalfoxArgsInput): string[] {
  return [
    'scan',
    i.targetsFile,
    '--input-type',
    'file',
    '--config',
    i.configFile,
    '-f',
    'json',
    '-o',
    i.outputFile,
    '--silence',
    '--no-color',
  ]
}
