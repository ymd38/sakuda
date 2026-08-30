export interface NucleiPathLine {
  lineNo: number
  base: 'front' | 'api'
  path: string
}

export function parseNucleiPathLines(text: string): {
  lines: NucleiPathLine[]
  errors: string[]
} {
  const lines: NucleiPathLine[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const m = /^(api:)?(\/\S*)$/.exec(line)
    if (!m) {
      errors.push(
        `line ${i + 1}: must be a path starting with "/" (optionally prefixed "api:"), got "${line}"`,
      )
      return
    }
    lines.push({ lineNo: i + 1, base: m[1] ? 'api' : 'front', path: m[2]! })
  })
  return { lines, errors }
}
