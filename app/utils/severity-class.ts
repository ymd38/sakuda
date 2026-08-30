/** Maps a severity string to the text color utility that signals it.
 * Only critical/high findings use {colors.sale} per DESIGN.md — that color
 * is reserved for danger/severity signals, never decorative chrome. */
export function severityTextClass(sev: string): string {
  if (sev === 'critical' || sev === 'high') return 'text-sale'
  if (sev === 'medium') return 'text-info'
  return 'text-mute'
}
