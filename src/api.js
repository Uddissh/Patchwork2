import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const instance = axios.create({
  baseURL: API_BASE,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
})

// Decompose/assemble can be LLM-backed on the server, so allow generous timeouts.
const LONG = { timeout: 180_000 }

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------------ */
/* Integration adapters: the views speak their own shapes; this layer  */
/* translates requests/responses to and from the FastAPI contract in   */
/* patchwork-backend/main.py. Nothing else in the frontend changes.    */
/* ------------------------------------------------------------------ */

// GET /health → { status }
async function checkHealth() {
  const { data } = await instance.get('/health')
  return data
}

// POST /decompose { request, budget, deadline_days, quantity }
// → { required_categories, reasoning }. All four fields are required
// floats/ints server-side, so blank form fields get safe defaults.
async function decompose(payload = {}) {
  const { data } = await instance.post(
    '/decompose',
    {
      request: String(payload.request ?? ''),
      budget: num(payload.budget) ?? 0,
      deadline_days: Math.round(num(payload.deadline_days) ?? 30),
      quantity: Math.round(num(payload.quantity) ?? 1),
    },
    LONG,
  )
  return data
}

// Supplier rows arrive priced as price_per_unit/line_total; surface `price`
// (the line total the UI totals, highlights and charges) and `days`.
const reshapeRow = (e) => ({
  ...e,
  price: num(e.line_total ?? e.price_per_unit) ?? 0,
  days: num(e.delivery_days ?? e.days),
})

// POST /assemble { required_categories, budget, deadline_days, quantity }
// → { network, total_cost, feasible, schedule }.
async function assemble(payload = {}) {
  const { data } = await instance.post(
    '/assemble',
    {
      required_categories: Array.isArray(payload.required_categories)
        ? payload.required_categories.filter((c) => typeof c === 'string' && c.trim())
        : [],
      budget: num(payload.budget) ?? 0,
      deadline_days: Math.round(num(payload.deadline_days) ?? 30),
      quantity: Math.round(num(payload.quantity) ?? 1),
    },
    LONG,
  )
  const rows = Array.isArray(data?.network) ? data.network : []
  return { ...data, network: rows.map(reshapeRow) }
}

// POST /assemble/options — same input as /assemble; returns three priced
// networks (cheapest / fastest / balanced), each { label, network, total_cost, max_days }.
async function assembleOptions(payload = {}) {
  const { data } = await instance.post(
    '/assemble/options',
    {
      required_categories: Array.isArray(payload.required_categories)
        ? payload.required_categories.filter((c) => typeof c === 'string' && c.trim())
        : [],
      budget: num(payload.budget) ?? 0,
      deadline_days: Math.round(num(payload.deadline_days) ?? 30),
      quantity: Math.round(num(payload.quantity) ?? 1),
    },
    LONG,
  )
  const list = Array.isArray(data) ? data : []
  return list.map((opt) => ({
    ...opt,
    network: (Array.isArray(opt?.network) ? opt.network : []).map(reshapeRow),
  }))
}

// POST /repair { failed_supplier_id, current_network }
// → { updated_network, replaced_supplier, new_total }. The view sends
// failed_node_id/network — remap them (and guarantee the line keys the
// server reads on every row). The reply is reshaped so the replacement
// surfaces as `replacement` with a real price/days.
async function repair(payload = {}) {
  const network = (Array.isArray(payload.network)
    ? payload.network
    : Array.isArray(payload.current_network)
      ? payload.current_network
      : []
  ).map((e) => ({
    ...e,
    quantity: num(e?.quantity) ?? 1,
    line_total: num(e?.line_total ?? e?.price) ?? 0,
    price_per_unit: num(e?.price_per_unit ?? e?.price) ?? 0,
  }))
  const failedId = payload.failed_supplier_id ?? payload.failed_node_id ?? payload.node_id
  const { data } = await instance.post(
    '/repair',
    { failed_supplier_id: String(failedId ?? ''), current_network: network },
    { timeout: 120_000 },
  )
  const rows = Array.isArray(data?.updated_network) ? data.updated_network : []
  const rep = data?.replaced_supplier ?? null
  const repRow = rep ? rows.find((e) => String(e?.id) === String(rep.id)) : null
  const replacement = rep
    ? {
        ...rep,
        price: num(repRow?.line_total ?? repRow?.price_per_unit ?? rep.price_per_unit) ?? 0,
        days: num(rep.delivery_days ?? rep.days),
      }
    : null
  return { ...data, replacement }
}

// POST /checkout { network, customer_email } → { order_id, approval_url }.
// Ledger items are line totals; the server needs both line_total and
// price_per_unit on every row (it reads the latter as an eager fallback).
// The UI collects no email, so a stable placeholder rides through to
// PayPal's pass-through custom_id field.
async function checkout(payload = {}) {
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.suppliers)
      ? payload.suppliers
      : Array.isArray(payload.network)
        ? payload.network
        : []
  const network = items.map((it) => {
    const line = num(it?.line_total ?? it?.price) ?? 0
    return {
      id: it?.id ?? it?.supplier_id ?? '',
      name: it?.name ?? it?.supplier ?? 'Supplier',
      category: it?.category ?? it?.stage ?? 'general',
      quantity: num(it?.quantity) ?? 1,
      line_total: line,
      price_per_unit: num(it?.price_per_unit ?? it?.price) ?? line,
    }
  })
  const { data } = await instance.post('/checkout', {
    network,
    customer_email: payload.customer_email ?? 'guest@patchwork.local',
  })
  return data
}

// POST /checkout/capture { order_id } → { status, payments }. Echo the
// order id back so the success screen can read it off the response.
async function capture(payload = {}) {
  const orderId = payload.order_id ?? payload.orderID
  const { data } = await instance.post('/checkout/capture', { order_id: orderId })
  return { ...data, order_id: orderId }
}

// POST /negotiate { network, constraint }
// → { suggestion, swap_category, reasoning } — any field may be null.
async function negotiate(payload = {}) {
  const rows = (Array.isArray(payload.network) ? payload.network : []).map((e) => ({
    id: e?.id ?? '',
    name: e?.name ?? 'Supplier',
    category: e?.category ?? 'general',
    quantity: num(e?.quantity) ?? 1,
    line_total: num(e?.line_total ?? e?.price) ?? 0,
    price_per_unit: num(e?.price_per_unit ?? e?.price) ?? 0,
    delivery_days: num(e?.delivery_days ?? e?.days) ?? 0,
  }))
  const { data } = await instance.post(
    '/negotiate',
    { network: rows, constraint: String(payload.constraint ?? '') },
    { timeout: 120_000 },
  )
  return data
}

export const api = { checkHealth, decompose, assemble, assembleOptions, repair, negotiate, checkout, capture }
export default api
