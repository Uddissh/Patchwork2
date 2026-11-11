import { API_BASE } from '../api.js'

// Session-storage key used to survive the PayPal redirect round-trip.
export const ORDER_CACHE_KEY = 'patchwork:lastOrder'

export const DEFAULT_STAGES = ['Design', 'Manufacturing', 'Printing', 'Packaging', 'Delivery']

export function money(n) {
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    : '—'
}

export function toNumber(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return null
}

export function describeError(e) {
  if (e?.response) {
    const d = e.response.data
    let msg = d
    if (d && typeof d === 'object') {
      msg = d.detail ?? d.error ?? d.message ?? JSON.stringify(d).slice(0, 200)
    }
    return `Backend ${e.response.status}: ${msg ?? e.response.statusText}`
  }
  if (e?.request) return `Cannot reach backend at ${API_BASE} — is it running?`
  return e?.message ?? String(e)
}

/* ------------------------------------------------------------------ */
/* Response-shape normalizers: the frontend tolerates many plausible   */
/* backend response shapes for each endpoint.                          */
/* ------------------------------------------------------------------ */

// Find the first non-empty array anywhere up to `depth` levels deep.
export function firstArray(value, depth = 2) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  for (const v of Object.values(value)) {
    if (Array.isArray(v) && v.length) return v
  }
  if (depth > 0) {
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = firstArray(v, depth - 1)
        if (found) return found
      }
    }
  }
  return null
}

const STAGE_KEYS = ['name', 'stage', 'stage_name', 'stageName', 'title', 'step', 'phase', 'type', 'label']
const NAME_KEYS = ['name', 'supplier', 'supplier_name', 'supplierName', 'vendor', 'vendor_name', 'company', 'company_name', 'title', 'label', 'id', 'node_id', 'supplier_id']
const PRICE_KEYS = ['price', 'cost', 'unit_price', 'unitPrice', 'total', 'total_cost', 'amount', 'rate', 'price_usd', 'cost_usd']
const DAYS_KEYS = ['days', 'delivery_days', 'deliveryDays', 'lead_time', 'leadTime', 'lead_time_days', 'delivery_time', 'eta', 'duration_days']
const ID_KEYS = ['id', 'node_id', 'nodeId', 'supplier_id', 'supplierId', '_id']

export function normalizeStages(res, fallback = DEFAULT_STAGES) {
  const arr = firstArray(res)
  if (!arr) return [...fallback]
  const names = arr
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return pick(item, STAGE_KEYS)
      return null
    })
    .filter((s) => typeof s === 'string' && s.trim())
  return names.length ? names.map((s) => String(s).trim()) : [...fallback]
}

export function stageIndexFor(category, stages, fallback = 0) {
  if (!category || !stages?.length) return fallback
  const c = String(category).toLowerCase()
  let idx = stages.findIndex((s) => s.toLowerCase() === c)
  if (idx === -1) idx = stages.findIndex((s) => c.includes(s.toLowerCase()) || s.toLowerCase().includes(c))
  return idx === -1 ? fallback : idx
}

// End-to-end lead time: stages run in sequence, suppliers within a stage
// run in parallel — so it is the per-stage MAX summed across stages.
// Summing every supplier would double-count parallel partners.
export function endToEndDays(suppliers) {
  if (!suppliers?.length) return null
  const byStage = new Map()
  for (const s of suppliers) {
    if (!Number.isFinite(s?.days)) continue
    const cur = byStage.get(s.stageIndex) ?? 0
    if (s.days > cur) byStage.set(s.stageIndex, s.days)
  }
  if (!byStage.size) return null
  return [...byStage.values()].reduce((a, b) => a + b, 0)
}

export function normalizeSupplier(item, index = 0, stages = []) {
  if (!item || typeof item !== 'object') return null
  const name = pick(item, NAME_KEYS)
  if (name == null) return null
  const category = pick(item, ['category', 'stage', 'stage_name', 'stageName', 'phase', 'step', 'type'])
  const stageCount = stages.length
  const fallbackIdx = stageCount ? Math.min(index, stageCount - 1) : 0
  const stageIndex = stageIndexFor(category, stages, fallbackIdx)
  return {
    id: String(pick(item, ID_KEYS) ?? `${stageIndex}-${index}`),
    name: String(name),
    category: category ? String(category) : stages[stageIndex] ?? 'Supplier',
    price: toNumber(pick(item, PRICE_KEYS)),
    days: toNumber(pick(item, DAYS_KEYS)),
    stageIndex,
    raw: item,
  }
}

export function normalizeSuppliers(res, stages = []) {
  // Priority: check known backend keys first before generic scan
  const root = res?.data ?? res?.result ?? res
  let arr = root?.network
    ?? root?.suppliers
    ?? root?.nodes
    ?? null

  // Fall back to generic scan only if priority keys not found
  if (!arr || !arr.length) arr = firstArray(res)

  // Fallback: object-of-stages, e.g. { "Design": {...}, "Manufacturing": {...} }
  if (!arr) {
    const root = res?.data ?? res?.result ?? res
    if (root && typeof root === 'object') {
      const entries = Object.entries(root).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
      if (entries.length) arr = entries.map(([k, v]) => ({ ...v, __stage: k }))
    }
  }
  if (!arr) return []
  if (arr.some((a) => Array.isArray(a))) arr = arr.flat()

  // Expand stage groups: { stage: 'Design', suppliers: [...] }
  const expanded = []
  for (const item of arr) {
    const group = item && typeof item === 'object' ? item.suppliers ?? item.nodes ?? item.options ?? item.children : null
    if (Array.isArray(group) && group.length) {
      const st = pick(item, STAGE_KEYS)
      for (const g of group) expanded.push({ ...g, __stage: st ?? g?.category })
    } else {
      expanded.push(item)
    }
  }

  const out = []
  expanded.forEach((item, i) => {
    const s = normalizeSupplier(item, i, stages)
    if (!s) return
    if (item?.__stage) {
      const si = stageIndexFor(item.__stage, stages, s.stageIndex)
      s.stageIndex = si
      if (!pick(item, ['category'])) s.category = stages[si] ?? String(item.__stage)
    }
    out.push(s)
  })

  const ordered = [...out].sort((a, b) => a.stageIndex - b.stageIndex)
  const counts = new Map()
  return ordered.map((s, i) => {
    const slot = counts.get(s.stageIndex) ?? 0
    counts.set(s.stageIndex, slot + 1)
    return { ...s, slot, key: `n${i}-${s.id}`, status: 'idle' }
  })
}

// First supplier-ish object in the repair response. Structured keys are
// trusted before any generic scan, so a request-title wrapper can never
// be mistaken for the replacement supplier.
const REPLACEMENT_KEYS = ['replacement', 'new_supplier', 'newSupplier', 'supplier', 'node', 'backup']
export function normalizeReplacement(res) {
  const hasName = (v) => v && typeof v === 'object' && !Array.isArray(v) && pick(v, NAME_KEYS) != null
  const candidates = []
  const scan = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 3 || candidates.length) return
    if (Array.isArray(v)) {
      for (const x of v) scan(x, depth + 1)
      return
    }
    // 1 — explicit structured keys win immediately.
    for (const key of REPLACEMENT_KEYS) {
      if (hasName(v[key])) {
        candidates.push(v[key])
        return
      }
    }
    // 2 — enqueue children before considering this object's own name, so
    // a labelled container never outranks the supplier nested inside it.
    for (const c of Object.values(v)) scan(c, depth + 1)
    if (candidates.length) return
    // 3 — the object itself (repair returning a bare supplier object).
    if (hasName(v)) candidates.push(v)
  }
  scan(res, 0)
  if (!candidates.length) return null
  const item = candidates[0]
  return {
    id: String(pick(item, ID_KEYS) ?? 'replacement'),
    name: String(pick(item, NAME_KEYS)),
    price: toNumber(pick(item, PRICE_KEYS)),
    days: toNumber(pick(item, DAYS_KEYS)),
    category: pick(item, ['category', 'stage', 'type']),
  }
}

export function normalizeApprovalUrl(res) {
  const r = res?.data ?? res ?? {}
  const direct = pick(r, ['approval_url', 'approvalUrl', 'approve_url', 'approve', 'redirect_url', 'redirectUrl', 'checkout_url', 'url', 'href', 'link'])
  if (typeof direct === 'string' && (direct.startsWith('http') || direct.startsWith('/'))) return direct
  const links = r.links ?? r.relationships
  if (Array.isArray(links)) {
    const l = links.find((x) => (x?.rel ?? x?.name) === 'approve' && x?.href)
    if (l?.href) return l.href
  }
  return null
}

export function normalizeCapture(res) {
  const r = res?.data ?? res ?? {}
  const status = String(pick(r, ['status', 'state', 'payment_status', 'capture_status']) ?? '').toUpperCase()
  return {
    id: String(pick(r, ['order_id', 'orderID', 'id', 'capture_id', 'payment_id']) ?? ''),
    status: ['COMPLETED', 'APPROVED', 'CAPTURED', 'PAID'].includes(status) ? 'PAID' : status || 'PAID',
  }
}
