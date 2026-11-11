/**
 * The network's chosen supplier per stage — ONE definition shared by
 * Network, Checkout and Success so every screen totals the same set.
 *
 *  1. If the API marks suppliers with a boolean `selected` field, that
 *     flag wins (read from the normalized entry or its raw payload).
 *  2. Otherwise the first supplier listed per stage (slot 0) is selected —
 *     the assembler's primary pick.
 *
 * A replacement inherits the slot of the supplier it replaces, so after a
 * reroute the replacement is selected and the failed supplier is gone.
 */
export function supplierSelection(suppliers) {
  const list = Array.isArray(suppliers) ? suppliers : []
  const usesFlag = list.some((s) => {
    const v = s?.selected ?? s?.raw?.selected
    return typeof v === 'boolean'
  })
  const chosen = new Set()
  if (usesFlag) {
    for (const s of list) {
      const v = s?.selected ?? s?.raw?.selected
      if (v === true) chosen.add(s.key)
    }
  } else {
    const first = new Map()
    for (const s of list) {
      const stage = s?.stageIndex ?? 0
      const cur = first.get(stage)
      if (!cur || (s?.slot ?? 0) < (cur.slot ?? 0)) first.set(stage, s)
    }
    for (const s of first.values()) chosen.add(s.key)
  }
  return { usesFlag, chosen, isSelected: (s) => chosen.has(s?.key) }
}

export function selectedSuppliers(suppliers) {
  const { isSelected } = supplierSelection(suppliers)
  return (Array.isArray(suppliers) ? suppliers : []).filter((s) => isSelected(s))
}
