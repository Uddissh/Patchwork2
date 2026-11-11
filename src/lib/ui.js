// Stage identity is structural, not chromatic: a mono index + label.
// Color is reserved for state (signal/ok/warn/crit).
export function stageTag(category, index = 0) {
  const label = String(category ?? 'Supplier').trim().toUpperCase()
  return `${String(Math.max(0, index) + 1).padStart(2, '0')} · ${label}`
}
