import { useEffect, useMemo, useRef, useState } from 'react'
import { animate, createTimeline, set, stagger } from 'animejs'
import { money } from '../lib/normalize.js'
import { selectedSuppliers } from '../lib/selection.js'
import { DUR, EASE, edgeDrawIn, reducedMotion, tweenMoney } from '../lib/motion.js'
import { useMotionScope } from '../lib/useMotionScope.js'
import { Icon } from './Icons.jsx'

function MetaRow({ k, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2.5">
      <dt className="text-[13px] text-secondary">{k}</dt>
      <dd className="metric text-[12.5px] text-ink">{children}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Payment split — the customer's single payment flows into PayPal,    */
/* which fans it out to every supplier: a dot per route, a green flash */
/* per arrival, staggered 400ms so it reads as real routing.           */
/* ------------------------------------------------------------------ */

const ROW = 64
const PAD = 20
const CARD_X = 296
const CARD_W = 252
const PP_X = 96
const PP_W = 132

function PaymentSplit({ payments, suppliers, total, orderId }) {
  const rows = useMemo(() => {
    const byId = new Map(suppliers.map((s) => [String(s.id), s]))
    return (payments ?? []).map((p, i) => {
      const s = byId.get(String(p?.reference_id))
      const amount = Number.parseFloat(p?.amount?.value)
      return {
        id: p?.capture_id ?? `pay-${i}`,
        name: s?.name ?? `Supplier ${i + 1}`,
        category: s?.category ?? 'supplier',
        amount: Number.isFinite(amount) ? amount : null,
      }
    })
  }, [payments, suppliers])

  const [paidCount, setPaidCount] = useState(0)
  const [done, setDone] = useState(false)
  const svgRef = useRef(null)

  const H = rows.length ? PAD * 2 + rows.length * ROW : 96
  const cy = H / 2
  const rowY = (i) => PAD + i * ROW + ROW / 2

  useEffect(() => {
    if (!rows.length) return undefined
    if (reducedMotion()) {
      setPaidCount(rows.length)
      setDone(true)
      return undefined
    }
    const root = svgRef.current
    if (!root) return undefined
    const timers = []
    const anims = []

    // The customer's payment flows into PayPal.
    const intakePath = root.querySelector('[data-line="intake"]')
    if (intakePath) anims.push(edgeDrawIn(intakePath, { duration: 500 }))
    const intakeDot = root.querySelector('[data-dot="intake"]')
    if (intakeDot) {
      anims.push(
        animate(intakeDot, {
          x: [0, PP_X - 10],
          opacity: [0, 1, 1, 0],
          duration: 560,
          delay: 60,
          ease: 'inOutQuad',
        }),
      )
    }
    // PayPal pulse, then one money particle per supplier, staggered 400ms.
    const pp = root.querySelector('[data-pp]')
    if (pp) {
      anims.push(animate(pp, { scale: [1, 1.06, 1], duration: 420, delay: 620, ease: 'inOutQuad' }))
    }
    rows.forEach((_, i) => {
      const line = root.querySelector(`[data-line="${i}"]`)
      if (line) anims.push(edgeDrawIn(line, { delay: 950 + i * 400, duration: 480 }))
      const dot = root.querySelector(`[data-dot="${i}"]`)
      if (dot) {
        anims.push(
          animate(dot, {
            x: [0, CARD_X - (PP_X + PP_W)],
            y: [0, rowY(i) - cy],
            duration: 620,
            delay: 1000 + i * 400,
            ease: 'inOutQuad',
            onComplete: () => {
              setPaidCount((c) => Math.max(c, i + 1))
              const flash = root.querySelector(`[data-flash="${i}"]`)
              if (flash) {
                anims.push(animate(flash, { opacity: [0.4, 0], duration: 650, ease: 'outQuad' }))
              }
            },
          }),
        )
      }
    })
    timers.push(setTimeout(() => setDone(true), 1150 + rows.length * 400 + 700))
    return () => {
      timers.forEach(clearTimeout)
      anims.forEach((a) => a?.cancel?.())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length])

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 560 ${H}`}
          className="w-full min-w-[480px]"
          role="img"
          aria-label="PayPal payment split across suppliers"
        >
          {/* intake — customer → PayPal */}
          <text x={6} y={cy - 10} fontSize="10.5" fill="var(--color-secondary)">
            {money(total)}
          </text>
          <path
            data-line="intake"
            className="edge-undrawn"
            d={`M6 ${cy} H${PP_X}`}
            fill="none"
            stroke="var(--color-forest)"
            strokeOpacity="0.5"
            strokeWidth="1.25"
          />
          <circle data-dot="intake" cx={6} cy={cy} r="3.5" fill="var(--color-forest)" opacity="0" />

          {/* PayPal node */}
          <g data-pp style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <rect
              x={PP_X}
              y={cy - 28}
              width={PP_W}
              height={56}
              rx={6}
              fill="var(--color-paper)"
              stroke="var(--color-line)"
            />
            <text
              x={PP_X + PP_W / 2}
              y={cy + 6}
              textAnchor="middle"
              fontSize="18"
              fontWeight="600"
              fontStyle="italic"
            >
              <tspan fill="#003087">Pay</tspan>
              <tspan fill="#0070ba">Pal</tspan>
            </text>
          </g>

          {/* fan-out — one route, dot and card per supplier */}
          {rows.map((r, i) => {
            const y = rowY(i)
            const paid = i < paidCount
            return (
              <g key={r.id}>
                <path
                  data-line={i}
                  className="edge-undrawn"
                  d={`M${PP_X + PP_W} ${cy} L${CARD_X} ${y}`}
                  fill="none"
                  stroke="var(--color-forest)"
                  strokeOpacity="0.5"
                  strokeWidth="1.25"
                />
                <circle
                  data-dot={i}
                  cx={PP_X + PP_W}
                  cy={cy}
                  r="3.5"
                  fill="var(--color-forest)"
                  opacity="0"
                />
                <rect
                  x={CARD_X}
                  y={y - 26}
                  width={CARD_W}
                  height={52}
                  rx={4}
                  fill="var(--color-paper)"
                  stroke={paid ? 'var(--color-moss)' : 'var(--color-line)'}
                />
                <rect
                  data-flash={i}
                  x={CARD_X}
                  y={y - 26}
                  width={CARD_W}
                  height={52}
                  rx={4}
                  fill="#7faf93"
                  opacity="0"
                  pointerEvents="none"
                />
                <text x={CARD_X + 12} y={y - 3} fontSize="12.5" fontWeight="600" fill="var(--color-ink)">
                  {r.name}
                </text>
                <text x={CARD_X + 12} y={y + 14} fontSize="10.5" fill="var(--color-secondary)">
                  {r.category} · {r.amount != null ? money(r.amount) : '—'}
                </text>
                {paid && (
                  <g aria-hidden>
                    <circle cx={CARD_X + CARD_W - 18} cy={y} r="9" fill="#7faf93" />
                    <path
                      d={`M${CARD_X + CARD_W - 22.5} ${y + 0.5} l3.5 3.5 l7 -8`}
                      stroke="#fff"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p
          className={`text-[13px] font-medium text-moss transition-opacity duration-300 ${
            done ? 'opacity-100' : 'opacity-0'
          }`}
        >
          ✓ Payment distributed to {rows.length} supplier{rows.length === 1 ? '' : 's'}
        </p>
        {orderId && (
          <span className="metric text-[10px] uppercase tracking-[0.16em] text-faint">
            PayPal sandbox · NO. {orderId}
          </span>
        )}
      </div>
    </div>
  )
}

export default function SuccessView({ order, suppliers, onRestart }) {
  // The dispatched network — the same selected set the Network screen
  // highlighted and Checkout charged.
  const selected = useMemo(() => selectedSuppliers(suppliers), [suppliers])
  const stageGroups = useMemo(() => {
    const map = new Map()
    for (const s of selected) {
      const i = Number.isFinite(s.stageIndex) ? s.stageIndex : 0
      if (!map.has(i)) map.set(i, s.category ?? `Stage ${i + 1}`)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [selected])
  const total = Number.isFinite(order?.total)
    ? order.total
    : selected.reduce((a, s) => a + (Number.isFinite(s.price) ? s.price : 0), 0)
  const orderId = order?.orderId || order?.id
  const totalRef = useRef(null)
  const prevTotal = useRef(0)

  const [rootRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    const tl = createTimeline({ defaults: { ease: EASE.inOut } })
    const ring = root.querySelector('.check-ring')
    const mark = root.querySelector('.check-mark')
    if (ring) {
      const L = ring.getTotalLength()
      set(ring, { strokeDasharray: `${L} ${L}`, strokeDashoffset: L })
      tl.add(ring, { strokeDashoffset: [L, 0], duration: 650 })
    }
    if (mark) {
      const L = mark.getTotalLength()
      set(mark, { strokeDasharray: `${L} ${L}`, strokeDashoffset: L })
      tl.add(mark, { strokeDashoffset: [L, 0], duration: 300 }, '-=120')
    }
    tl.add(
      root.querySelectorAll('[data-success-block]'),
      { opacity: [0, 1], y: [10, 0], delay: stagger(70), duration: DUR.base, ease: EASE.out },
      '-=140',
    )
  }, [])

  useEffect(() => {
    tweenMoney(totalRef.current, prevTotal.current, total)
    prevTotal.current = total
  }, [total])

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-2xl px-6 py-10 lg:py-12">
      <div className="panel scroll-mt-24 px-7 py-9 sm:px-10">
        {/* dispatch tracker — first stage in progress, the rest queued */}
        {stageGroups.length > 0 && (
          <div data-success-block className="mb-8 border-b border-line pb-7">
            <p className="kicker">Dispatch tracker</p>
            <ol className="mt-4">
              {stageGroups.map(([stageIndex, name], idx) => (
                <li key={stageIndex} className="relative flex items-center gap-3 py-1.5 pl-7">
                  {idx < stageGroups.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute left-[5px] top-[18px] h-[calc(100%-10px)] w-px bg-line"
                    />
                  )}
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border ${
                      idx === 0 ? 'border-[#e5560a] bg-[#e5560a]' : 'border-faint bg-paper'
                    }`}
                  />
                  <span className="text-[13.5px] font-medium text-ink">{name}</span>
                  <span
                    className={`ml-auto font-mono text-[10px] uppercase tracking-[0.14em] ${
                      idx === 0 ? 'text-[#e5560a]' : 'text-faint'
                    }`}
                  >
                    {idx === 0 ? 'In progress' : 'Queued'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div data-success-block className="flex items-baseline justify-between gap-4">
          <p className="kicker">Dispatch note</p>
          {orderId && <span className="metric text-[11px] text-secondary">NO. {orderId}</span>}
        </div>

        <div data-success-block className="mt-7 flex items-center gap-4">
          <svg viewBox="0 0 64 64" className="check-svg" role="img" aria-label="Payment captured">
            <circle className="check-ring" cx="32" cy="32" r="28" />
            <path className="check-mark" d="M21 33.5 29.5 42 44 25" />
          </svg>
          <h1 className="font-display text-[34px] font-medium leading-none tracking-[-0.01em] text-ink">
            Confirmed.
          </h1>
        </div>

        <p data-success-block className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-secondary">
          Payment captured via PayPal{order?.status ? ` · ${order.status}` : ''}. The supplier
          network below is funded and cleared for dispatch.
        </p>

        <dl data-success-block className="mt-8 border-t border-line">
          <MetaRow k="Captured via">PayPal</MetaRow>
          <MetaRow k="Status">{order?.status ?? 'COMPLETED'}</MetaRow>
          <MetaRow k="Suppliers">{selected.length || '—'}</MetaRow>
        </dl>

        {selected.length > 0 ? (
          <div data-success-block className="mt-9">
            <p className="label">Suppliers in your network</p>
            <ul>
              {selected.map((s) => (
                <li
                  key={s.key}
                  className="flex items-baseline justify-between gap-4 border-b border-line-soft py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-ink">{s.name}</span>
                    <span className="stage-tag">{s.category}</span>
                  </span>
                  <span className="metric text-[13.5px] text-ink">{money(s.price)}</span>
                </li>
              ))}
            </ul>
            <div className="pt-4">
              <div aria-hidden className="double-rule" />
              <div className="flex items-baseline justify-between pt-3.5">
                <span className="text-[14px] font-semibold text-ink">Total paid</span>
                <span ref={totalRef} className="metric text-[22px] font-medium text-ink" />
              </div>
            </div>
          </div>
        ) : (
          <p data-success-block className="mt-8 max-w-[48ch] text-sm leading-relaxed text-secondary">
            Network snapshot unavailable in this session — the captured amount is listed on your
            PayPal receipt.
          </p>
        )}

        {order?.payments?.length > 0 && (
          <div data-success-block className="mt-9 border-t border-line pt-7">
            <p className="label">Payment routing</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-secondary">
              One payment in — settled separately to every supplier.
            </p>
            <div className="mt-5">
              <PaymentSplit payments={order.payments} suppliers={suppliers} total={total} orderId={orderId} />
            </div>
          </div>
        )}

        <div data-success-block className="mt-9 flex items-center justify-between gap-4">
          <button type="button" onClick={onRestart} className="btn btn-primary">
            <Icon name="refresh" className="h-4 w-4" />
            New request
          </button>
          <span className="metric text-[10px] uppercase tracking-[0.16em] text-faint">
            End of document
          </span>
        </div>
      </div>
    </div>
  )
}

