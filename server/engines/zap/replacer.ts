import type { Header } from '#shared/schemas/headers'

const esc = (v: string) => v.replace(/\\/g, '\\\\')

// Builds a ZAP `replacer` add-on config file that injects request headers (e.g. auth tokens)
// into every outbound request during a scan. Header values are written in plain text by
// design — this is only ever persisted to disk by the caller with restrictive (0600) file
// permissions, and its contents must never be logged.
export function buildReplacerConf(headers: Header[]): string {
  return (
    headers
      .map((h, i) =>
        [
          `replacer.full_list(${i}).description=sakuda header ${h.name}`,
          `replacer.full_list(${i}).enabled=true`,
          `replacer.full_list(${i}).matchtype=REQ_HEADER`,
          `replacer.full_list(${i}).matchstr=${h.name}`,
          `replacer.full_list(${i}).regex=false`,
          `replacer.full_list(${i}).replacement=${esc(h.value)}`,
        ].join('\n'),
      )
      .join('\n') + (headers.length ? '\n' : '')
  )
}
