import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes a fake `zap.sh` used by runZap/zapFe/zapApi specs. It is a real
 * spawned process (not a mock): it reads `SAKUDA_ZAP_HOST_WORKDIR` (the host
 * work dir — `-autorun`/`-configfile` paths may be container paths that
 * don't exist on the test host), records its own argv and the env vars
 * runZap sets, records the `replacer.conf` file mode when present (0600 is
 * asserted by the caller), and copies `fixturePath` to `report.json` unless
 * `FAKE_ZAP_NO_REPORT=1` is set in the test process's env (inherited by the
 * spawned child). `outputFile` lets discovery specs have it produce the
 * site-tree dump instead of a report.
 */
export function writeFakeZap(
  dir: string,
  fixturePath: string,
  name = 'fake-zap.js',
  outputFile = 'report.json',
): string {
  const script = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const hostWorkDir = process.env.SAKUDA_ZAP_HOST_WORKDIR
fs.writeFileSync(path.join(hostWorkDir, 'argv.json'), JSON.stringify(process.argv.slice(2)))
fs.writeFileSync(
  path.join(hostWorkDir, 'env.json'),
  JSON.stringify({
    JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS ?? null,
    SAKUDA_ZAP_HOST_WORKDIR: process.env.SAKUDA_ZAP_HOST_WORKDIR ?? null,
  }),
)
const confFile = path.join(hostWorkDir, 'replacer.conf')
if (fs.existsSync(confFile)) {
  fs.writeFileSync(
    path.join(hostWorkDir, 'conf-mode.json'),
    String(fs.statSync(confFile).mode & 0o777),
  )
}
const secretFile = path.join(hostWorkDir, 'browser-storage.js')
if (fs.existsSync(secretFile)) {
  fs.writeFileSync(
    path.join(hostWorkDir, 'secret-mode.json'),
    String(fs.statSync(secretFile).mode & 0o777),
  )
}
if (process.env.FAKE_ZAP_NO_REPORT !== '1') {
  fs.copyFileSync(${JSON.stringify(fixturePath)}, path.join(hostWorkDir, ${JSON.stringify(outputFile)}))
}
process.exit(0)
`
  const p = join(dir, name)
  writeFileSync(p, script)
  chmodSync(p, 0o755)
  return p
}
