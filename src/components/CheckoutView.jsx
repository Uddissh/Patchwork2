import { useEffect, useMemo, useRef, useState } from 'react'
import { animate, createTimeline, stagger } from 'animejs'
import { api } from '../api.js'
import { describeError, endToEndDays, money, normalizeApprovalUrl, ORDER_CACHE_KEY } from '../lib/normalize.js'
import { selectedSuppliers } from '../lib/selection.js'
import { stageTag } from '../lib/ui.js'
import { DUR, EASE, reducedMotion, tweenMoney } from '../lib/motion.js'
import { useMotionScope } from '../lib/useMotionScope.js'
import DeadlineBadge from './DeadlineBadge.jsx'
import { Icon } from './Icons.jsx'

const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// One payment fanning out to N merchants.
function FanOut({ n }) {
  const count = Math.max(1, Math.min(n || 1, 9))
  const ys = []
  for (let i = 0; i < count; i++) ys.push(count === 1 ? 12 : 4 + (i * 16) / (count - 1))
  return (
    <svg width="168" height="72" viewBox="0 0 56 24" aria-hidden className="flex-none">
      <circle cx="5" cy="12" r="3" fill="var(--color-forest)" />
      {ys.map((y, i) => (
        <g key={i}>
          <path d={`M9 12 L47 ${y}`} stroke="var(--color-forest)" strokeOpacity="0.45" strokeWidth="1" />
          <circle cx="49" cy={y} r="2.5" fill="none" stroke="var(--color-forest)" strokeOpacity="0.7" />
        </g>
      ))}
    </svg>
  )
}

export default function CheckoutView({ stages, suppliers, form, onBack, showToast }) {
  const [paying, setPaying] = useState(false)
  const payBtnRef = useRef(null)
  const totalLedgerRef = useRef(null)
  const totalDueRef = useRef(null)
  const prevTotal = useRef(0)

  // The charge follows the shared selection definition — the same set the
  // Network screen highlights and totals.
  const selected = useMemo(() => selectedSuppliers(suppliers), [suppliers])

  const total = useMemo(
    () => selected.reduce((a, s) => a + (Number.isFinite(s.price) ? s.price : 0), 0),
    [selected],
  )
  const lead = useMemo(() => endToEndDays(selected), [selected])
  const budget = numOrNull(form?.budget)
  const deadline = numOrNull(form?.deadline)

  const groups = useMemo(() => {
    const map = new Map()
    for (const s of selected) {
      const i = Number.isFinite(s.stageIndex) ? s.stageIndex : 0
      if (!map.has(i)) map.set(i, [])
      map.get(i).push(s)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [selected])

  const [rootRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    const tl = createTimeline({ defaults: { ease: EASE.out, duration: DUR.base } })
    const head = root.querySelectorAll('[data-ledger-head]')
    const rows = root.querySelectorAll('[data-ledger-row]')
    const foot = root.querySelectorAll('[data-ledger-foot]')
    const aside = root.querySelectorAll('[data-aside]')
    if (head.length) tl.add(head, { opacity: [0, 1], y: [6, 0] })
    if (rows.length) tl.add(rows, { opacity: [0, 1], y: [8, 0], delay: stagger(40) }, '-=260')
    if (foot.length) tl.add(foot, { opacity: [0, 1], y: [6, 0] }, '-=200')
    if (aside.length) tl.add(aside, { opacity: [0, 1], y: [10, 0], duration: DUR.slow }, '-=420')
  }, [])

  // Both currency readouts are tweened on refs — no per-frame re-renders.
  useEffect(() => {
    tweenMoney(totalLedgerRef.current, prevTotal.current, total)
    tweenMoney(totalDueRef.current, prevTotal.current, total)
    prevTotal.current = total
  }, [total])

  // One-shot PayPal pulse, timed just after the page-enter (~400ms) lands.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!reducedMotion() && payBtnRef.current) {
        animate(payBtnRef.current, { scale: [1, 1.035, 1], duration: 520, ease: 'inOutQuad' })
      }
    }, 480)
    return () => clearTimeout(t)
  }, [])

  async function pay() {
    if (paying) return
    setPaying(true)
    try {
      const items = selected.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        stage: stages[s.stageIndex] ?? s.category,
        price: s.price,
        days: s.days,
      }))
      const payload = {
        suppliers: items,
        items,
        total,
        total_cost: total,
        grand_total: total,
        currency: 'USD',
        description: form?.description ?? '',
        quantity: numOrNull(form?.quantity),
        deadline: numOrNull(form?.deadline),
      }
      const res = await api.checkout(payload)
      const url = normalizeApprovalUrl(res)
      if (!url) throw new Error('Checkout response contained no approval_url.')
      // Persist the network so it survives the PayPal redirect round-trip.
      try {
        sessionStorage.setItem(ORDER_CACHE_KEY, JSON.stringify({ suppliers, stages, form }))
      } catch {
        /* non-fatal */
      }
      window.location.href = url
    } catch (err) {
      showToast('error', describeError(err))
      setPaying(false)
    }
  }

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-10">
      <button type="button" onClick={onBack} className="btn btn-quiet">
        ← Back to network
      </button>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="kicker">03 — Checkout</p>
          <h1 className="mt-3 font-display text-[30px] font-medium leading-tight tracking-[-0.01em] text-ink">
            Review & pay
          </h1>
        </div>
        <p className="max-w-[46ch] pb-1 text-[13.5px] leading-relaxed text-secondary">
          Funding releases the network for dispatch. Payment is processed by PayPal — you approve
          there and return here to capture.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-5">
        <FanOut n={selected.length} />
        <p className="text-[12.5px] text-secondary">
          One payment →{' '}
          <span className="font-semibold text-ink">
            {selected.length} merchant{selected.length === 1 ? '' : 's'}
          </span>
          , settled separately via PayPal
        </p>
      </div>

      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_320px] lg:gap-16">
        {/* the transaction ledger, grouped by stage */}
        <div className="ledger">
          {groups.map(([stageIndex, list]) => {
            const sub = list.reduce((a, s) => a + (Number.isFinite(s.price) ? s.price : 0), 0)
            const stageName = stages[stageIndex] ?? list[0]?.category ?? 'Stage'
            // Solo stage: the header and its single row merge into one line.
            if (list.length === 1) {
              const s = list[0]
              return (
                <div
                  key={stageIndex}
                  data-ledger-head
                  className="mt-10 grid grid-cols-[1fr_64px_110px] items-baseline gap-3 border-b border-ink pb-2.5 first:mt-0"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="ledger-head">{stageTag(stageName, stageIndex)}</span>
                    <span className="truncate text-[14.5px] font-semibold tracking-[-0.005em] text-ink">
                      {s.name}
                    </span>
                  </div>
                  <span className="metric text-right text-[12px] text-secondary">
                    {s.days != null ? `${s.days}d` : '—'}
                  </span>
                  <span className="metric text-right text-[14px] text-ink">{money(s.price)}</span>
                </div>
              )
            }
            return (
              <section key={stageIndex}>
                <div
                  data-ledger-head
                  className="mt-10 flex items-baseline justify-between gap-4 border-b border-ink pb-2 first:mt-0"
                >
                  <span className="ledger-head">{stageTag(stageName, stageIndex)}</span>
                  <span className="metric text-[11.5px] text-secondary">
                    {list.length} suppliers · {money(sub)}
                  </span>
                </div>
                {list.map((s) => (
                  <div
                    data-ledger-row
                    key={s.key}
                    className="grid grid-cols-[1fr_64px_110px] items-baseline gap-3 border-b border-line-soft py-3"
                  >
                    <p className="truncate text-[14.5px] font-semibold tracking-[-0.005em] text-ink">
                      {s.name}
                    </p>
                    <span className="metric text-right text-[12px] text-secondary">
                      {s.days != null ? `${s.days}d` : '—'}
                    </span>
                    <span className="metric text-right text-[14px] text-ink">{money(s.price)}</span>
                  </div>
                ))}
              </section>
            )
          })}

          <div data-ledger-foot className="pt-4">
            <div aria-hidden className="double-rule" />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-3.5">
              <span className="text-[14px] font-semibold text-ink">
                Total due
                <span className="ml-2 font-normal text-secondary">· {selected.length} selected suppliers</span>
              </span>
              <span ref={totalLedgerRef} className="metric text-[22px] font-medium text-ink" />
            </div>
          </div>
        </div>

        {/* payment summary — sticky beside the ledger */}
        <aside data-aside className="h-fit lg:sticky lg:top-20">
          <p className="label">Payment</p>
          <div className="border-t border-ink pt-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p ref={totalDueRef} className="font-display text-[34px] font-medium leading-none text-ink" />
              <DeadlineBadge lead={lead} deadline={deadline} />
            </div>
            {budget != null && budget > 0 && budget >= total && (
              <p className="metric mt-2.5 text-[12px] text-secondary">target {money(budget)}</p>
            )}
          </div>

          <div aria-hidden className="hline my-6" />

          <button ref={payBtnRef} type="button" onClick={pay} disabled={paying} className="btn btn-paypal w-full">
            {paying ? (
              <>
                <Icon name="spinner" className="h-4 w-4 animate-spin" />
                Redirecting to PayPal…
              </>
            ) : (
              <>
                Pay with{' '}
                <span className="italic tracking-tight">
                  <span>Pay</span>
                  <span className="text-[#0070ba]">Pal</span>
                </span>
              </>
            )}
          </button>
          <p className="mt-3.5 flex items-center justify-center gap-1.5 text-center text-[12px] leading-relaxed text-secondary">
            <Icon name="lock" className="h-3 w-3 flex-none" />
            Buyer protection on every order
          </p>

          <dl className="mt-8 border-t border-line-soft">
            {lead != null && (
              <div className="flex items-baseline justify-between border-b border-line-soft py-2.5">
                <dt className="text-[13px] text-secondary">Est. end-to-end lead</dt>
                <dd className="metric text-[12.5px] text-ink">{lead} days</dd>
              </div>
            )}
            {form?.quantity ? (
              <div className="flex items-baseline justify-between border-b border-line-soft py-2.5">
                <dt className="text-[13px] text-secondary">Quantity</dt>
                <dd className="metric text-[12.5px] text-ink">{form.quantity}</dd>
              </div>
            ) : null}
            {form?.deadline ? (
              <div className="flex items-baseline justify-between border-b border-line-soft py-2.5">
                <dt className="text-[13px] text-secondary">Deadline</dt>
                <dd className="metric text-[12.5px] text-ink">{form.deadline} days</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  )
}
