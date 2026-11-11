import { useEffect, useRef, useState } from 'react'
import { animate, createTimeline, stagger } from 'animejs'
import { api, API_BASE } from '../api.js'
import { describeError, money, normalizeStages, normalizeSuppliers } from '../lib/normalize.js'
import { DUR, EASE, flipHandoff, reducedMotion } from '../lib/motion.js'
import { useMotionScope } from '../lib/useMotionScope.js'
import { Icon } from './Icons.jsx'

const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const PROCESS = [
  { n: '01', title: 'Decompose', body: 'Your brief becomes a staged production pipeline.' },
  { n: '02', title: 'Assemble', body: 'Qualified suppliers are matched into a costed network.' },
  { n: '03', title: 'Execute', body: 'Fund it through PayPal; the chain dispatches.' },
]

/* ------------------------------------------------------------------ */
/* Assembling overlay — full-screen holding screen while the API runs. */
/* Dots for the five categories land one by one (200ms stagger) and    */
/* pulse round-robin until the response arrives, then the screen       */
/* slides away before the page transition hands off to Network.        */
/* ------------------------------------------------------------------ */

const OVERLAY_CATEGORIES = ['design', 'manufacturing', 'printing', 'packaging', 'delivery']

function AssembleOverlay({ leaving, onGone }) {
  const [rootRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    const title = root.querySelector('[data-overlay-title]')
    const dots = root.querySelectorAll('[data-dot]')
    const tl = createTimeline({ defaults: { ease: EASE.out } })
    if (title) tl.add(title, { opacity: [0, 1], y: [8, 0], duration: 320 })
    if (dots.length) {
      tl.add(dots, { opacity: [0, 1], duration: 300, delay: stagger(200) }, '-=100')
      // The "active" dot: round-robin pulse while assembly runs.
      dots.forEach((d, i) => {
        animate(d, { scale: [1, 1.35, 1], duration: 640, delay: 400 + i * 200, ease: 'inOutQuad', loop: true })
      })
    }
  }, [])

  useEffect(() => {
    if (!leaving) return undefined
    if (reducedMotion()) {
      onGone?.()
      return undefined
    }
    const el = rootRef.current
    if (!el) {
      onGone?.()
      return undefined
    }
    const anim = animate(el, {
      opacity: [1, 0],
      y: [0, -48],
      duration: 340,
      ease: EASE.in,
      onComplete: () => onGone?.(),
    })
    return () => anim?.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])

  return (
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-limestone"
    >
      <p data-overlay-title className="font-display text-[22px] font-medium tracking-[-0.01em] text-ink">
        Assembling your network…
      </p>
      <div className="mt-8 flex items-start gap-6">
        {OVERLAY_CATEGORIES.map((c) => (
          <span key={c} className="flex flex-col items-center gap-2.5">
            <span data-dot className="h-2.5 w-2.5 rounded-full bg-forest" />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">{c}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const EXAMPLES = [
  {
    label: '500 ceramic mugs',
    description:
      '500 custom ceramic mugs with a two-color logo print, matte black glaze, individual gift boxes, delivered to Austin TX',
    budget: '10000',
    deadline: '30',
    quantity: '500',
  },
  {
    label: '1000 branded hoodies',
    description:
      '1000 branded hoodies with a three-color front screen print, embroidered sleeve logo, poly-bagged, shipped to Denver CO',
    budget: '18000',
    deadline: '45',
    quantity: '1000',
  },
  {
    label: '100 employee welcome kits',
    description:
      '100 employee welcome kits with a notebook, enamel pin, tote bag and printed onboarding card, kraft gift box, delivered to Chicago IL',
    budget: '6000',
    deadline: '21',
    quantity: '100',
  },
]

/* ------------------------------------------------------------------ */
/* Insight flash — 2s hold after assembly: the LLM's reasoning plus    */
/* the required categories as pills. Tap anywhere (or wait) continues. */
/* Skipped entirely when reasoning is missing or motion is reduced.    */
/* ------------------------------------------------------------------ */

function InsightFlash({ reasoning, categories, onDone }) {
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  const [rootRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    const title = root.querySelector('[data-insight-text]')
    const pills = root.querySelectorAll('[data-pill]')
    const tl = createTimeline({ defaults: { ease: EASE.out } })
    if (title) tl.add(title, { opacity: [0, 1], y: [10, 0], duration: 360 })
    if (pills.length) {
      tl.add(pills, { opacity: [0, 1], y: [8, 0], duration: 300, delay: stagger(150) }, '-=120')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doneRef.current?.(), 2000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-label="Decomposition insight — tap to continue"
      onClick={() => doneRef.current?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') doneRef.current?.()
      }}
      className="fixed inset-0 z-[70] flex cursor-pointer flex-col items-center justify-center bg-limestone px-6 text-center"
    >
      <p className="kicker">Decomposition insight</p>
      <p
        data-insight-text
        className="mt-5 max-w-[54ch] font-display text-[20px] font-medium leading-snug tracking-[-0.01em] text-ink"
      >
        {reasoning}
      </p>
      {categories.length > 0 && (
        <div className="mt-8 flex max-w-[520px] flex-wrap justify-center gap-2">
          {categories.map((c) => (
            <span key={c} data-pill className="stage-tag">
              {c}
            </span>
          ))}
        </div>
      )}
      <p className="mt-12 text-[11px] text-faint">Tap anywhere to continue</p>
    </div>
  )
}

export default function RequestView({ form, setForm, onAssembled, showToast }) {
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState(null)
  const [conn, setConn] = useState('idle') // idle | checking | ok | fail
  const mounted = useRef(true)
  // Assembling overlay lifecycle — promise-gated, so onAssembled (and the
  // page transition) wait for the slide-away to finish.
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayLeaving, setOverlayLeaving] = useState(false)
  const overlayDoneRef = useRef(null)
  const overlayShownRef = useRef(false)

  const handleOverlayGone = () => {
    overlayShownRef.current = false
    setShowOverlay(false)
    setOverlayLeaving(false)
    const done = overlayDoneRef.current
    overlayDoneRef.current = null
    done?.()
  }

  const dismissOverlay = () =>
    new Promise((resolve) => {
      if (!overlayShownRef.current) return resolve()
      if (reducedMotion()) {
        handleOverlayGone()
        resolve()
        return
      }
      overlayDoneRef.current = resolve
      setOverlayLeaving(true)
    })

  // 2s insight flash between overlay and the page transition.
  const [insight, setInsight] = useState(null)
  const insightDoneRef = useRef(null)

  const showInsight = (decomposition) =>
    new Promise((resolve) => {
      if (reducedMotion() || !decomposition?.reasoning) return resolve()
      insightDoneRef.current = resolve
      setInsight({
        reasoning: decomposition.reasoning,
        categories: decomposition.required_categories ?? [],
      })
    })

  const finishInsight = () => {
    setInsight(null)
    const done = insightDoneRef.current
    insightDoneRef.current = null
    done?.()
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const applyExample = (ex) => {
    setForm({ description: ex.description, budget: ex.budget, deadline: ex.deadline, quantity: ex.quantity })
    setError(null)
  }

  useEffect(() => {
    mounted.current = true
    testConnection(true)
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [rootRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    animate(root.querySelectorAll('[data-enter]'), {
      opacity: [0, 1],
      y: [12, 0],
      duration: DUR.slow,
      delay: stagger(110),
      ease: EASE.out,
    })
  }, [])

  async function testConnection(silent = false) {
    setConn('checking')
    try {
      await api.checkHealth()
      if (!mounted.current) return
      setConn('ok')
      if (!silent) showToast('success', 'Backend connected ✓')
    } catch {
      if (!mounted.current) return
      setConn('fail')
      if (!silent) showToast('error', `Backend unreachable at ${API_BASE} ✗`)
    }
  }

  async function handleAssemble(e) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!form.description.trim()) {
      setError('Describe what you need first — the decomposer needs a brief.')
      return
    }
    const payload = {
      request: form.description.trim(),  // ← change THIS
      budget: numOrNull(form.budget),
      deadline_days: numOrNull(form.deadline),
      quantity: numOrNull(form.quantity),
    }
    // Shared-element FLIP: record where the budget readout sits now, so
    // NetworkView can fly it to the total-cost metric after the transition.
    const flipEl = document.querySelector('[data-flip-budget]')
    if (flipEl) {
      const r = flipEl.getBoundingClientRect()
      if (r.width) {
        flipHandoff.current = {
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          text: money(numOrNull(form.budget)) ?? '',
        }
      }
    }
    setBusy(true)
    overlayShownRef.current = true
    setOverlayLeaving(false)
    setShowOverlay(true)
    try {
      setPhase('Decomposing your request…')
      const decomposition = await api.decompose(payload)
      const stages = normalizeStages(decomposition)
      setPhase(`Assembling supplier network · ${stages.length} stage${stages.length === 1 ? '' : 's'}…`)
      const assembly = await api.assemble({
        request: payload.request,
        budget: payload.budget,
        deadline_days: payload.deadline_days,
        quantity: payload.quantity,
        required_categories: decomposition.required_categories,
      })
      const suppliers = normalizeSuppliers(assembly, stages)
      if (!suppliers.length) throw new Error('Assemble returned no suppliers — unexpected response shape.')
      await dismissOverlay() // hold the screen until the response is in hand
      await showInsight(decomposition) // 2s LLM insight flash (tap to skip)
      onAssembled({ stages, suppliers, raw: assembly, decomposition })
    } catch (err) {
      await dismissOverlay()
      setError(describeError(err))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-6xl px-6 py-14 lg:px-10 lg:py-20">
      <div className="grid gap-14 lg:grid-cols-[5fr_7fr] lg:gap-20">
        {/* editorial column */}
        <div data-enter>
          <p className="kicker">01 — Request</p>
          <h1 className="mt-5 font-display text-[38px] font-medium leading-[1.06] tracking-[-0.015em] text-ink sm:text-[44px]">
            Commission a supply chain.
          </h1>
          <p className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-secondary">
            Describe the order. PATCHWORK decomposes the brief into pipeline stages and assembles
            qualified suppliers across design, manufacturing, printing, packaging and delivery.
          </p>

          <ol className="mt-12">
            {PROCESS.map((p) => (
              <li key={p.n} className="flex gap-5 border-t border-line-soft py-4 first:border-t-0 first:pt-0 lg:border-t lg:py-5 lg:first:pt-5">
                <span className="metric pt-0.5 text-[11px] text-faint">{p.n}</span>
                <div>
                  <p className="text-[14px] font-semibold text-ink">{p.title}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-secondary">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* ghost network — decorative preview of what the canvas will build */}
          <div aria-hidden className="pointer-events-none mt-14 hidden select-none lg:block">
            <svg viewBox="0 0 480 240" className="w-full max-w-[480px] opacity-80">
              {[0, 1, 2, 3, 4].map((i) => (
                <line
                  key={`lane-${i}`}
                  x1={12 + i * 96 + 36}
                  y1={8}
                  x2={12 + i * 96 + 36}
                  y2={232}
                  stroke="var(--color-line)"
                  strokeWidth="1"
                />
              ))}
              {/* chosen chain: orthogonal connectors */}
              <path
                d="M84 54 H132 V138 H228 V82 H324 V170 H420 V114"
                fill="none"
                stroke="var(--color-line)"
                strokeWidth="1.25"
              />
              {/* chosen boxes */}
              {[
                { x: 12, y: 36 },
                { x: 108, y: 120 },
                { x: 204, y: 64 },
                { x: 300, y: 152 },
                { x: 396, y: 96 },
              ].map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width="72" height="36" rx="2" fill="var(--color-paper)" stroke="var(--color-secondary)" strokeOpacity="0.55" />
              ))}
              {/* alternatives, fainter */}
              {[
                { x: 108, y: 186 },
                { x: 204, y: 172 },
                { x: 300, y: 52 },
              ].map((b, i) => (
                <rect key={`a-${i}`} x={b.x} y={b.y} width="72" height="36" rx="2" fill="none" stroke="var(--color-line)" />
              ))}
            </svg>
          </div>
        </div>

        {/* the request document */}
        <div data-enter className="h-fit">
          <form onSubmit={handleAssemble} className="panel p-7 lg:p-9">
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-5">
              <p className="text-[16px] font-semibold text-ink">New request</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                Request for assembly
              </span>
            </div>

            <div className="mt-7">
              <label className="label" htmlFor="description">
                Describe the build
              </label>
              <textarea
                id="description"
                rows={4}
                className="field"
                placeholder="e.g. 500 custom ceramic mugs with a two-color logo print, matte black glaze, individual gift boxes, delivered to Austin TX…"
                value={form.description}
                onChange={set('description')}
              />
              <div className="mt-3.5 flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
                <span className="text-[12px] text-faint">Try:</span>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => applyExample(ex)}
                    className="whitespace-nowrap rounded-full border border-line bg-paper px-3 py-1.5 text-[11px] text-secondary transition hover:border-ink hover:text-ink"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

          <div className="mt-9 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="budget">
                Budget
              </label>
              <div className="flex items-baseline gap-2 border-b border-line transition-colors focus-within:border-ink" data-flip-budget="">
                <span aria-hidden className="unit">
                  $
                </span>
                <input
                  id="budget"
                  type="number"
                  min="0"
                  step="0.01"
                  className="field"
                  placeholder="2,000"
                  value={form.budget}
                  onChange={set('budget')}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="deadline">
                Deadline
              </label>
              <div className="flex items-baseline gap-2 border-b border-line transition-colors focus-within:border-ink">
                <input
                  id="deadline"
                  type="number"
                  min="1"
                  className="field"
                  placeholder="30"
                  value={form.deadline}
                  onChange={set('deadline')}
                />
                <span aria-hidden className="unit">
                  days
                </span>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="quantity">
                Quantity
              </label>
              <div className="flex items-baseline gap-2 border-b border-line transition-colors focus-within:border-ink">
                <input
                  id="quantity"
                  type="number"
                  min="1"
                  className="field"
                  placeholder="100"
                  value={form.quantity}
                  onChange={set('quantity')}
                />
                <span aria-hidden className="unit">
                  units
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-7 border-l-2 border-brick py-1 pl-4 text-sm leading-relaxed text-brick"
            >
              {error}
            </div>
          )}

          <div className="mt-9">
            <button type="submit" disabled={busy} className="btn btn-primary w-full sm:w-auto sm:px-8">
              {busy ? (
                <>
                  <Icon name="spinner" className="h-4 w-4 animate-spin" />
                  {phase || 'Working…'}
                </>
              ) : (
                <>
                  Assemble network
                  <Icon name="arrow" className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
          </form>

          {/* connection status — a footer pill beneath the document */}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <span className="metric text-[11px] text-faint">GET {API_BASE}/health</span>
            <button
              type="button"
              onClick={() => testConnection(false)}
              className="btn btn-quiet"
            >
              Test connection
            </button>
            {conn === 'checking' ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-1.5 text-[12px] font-medium text-secondary">
                <Icon name="spinner" className="h-3 w-3 animate-spin" /> Checking…
              </span>
            ) : conn === 'ok' ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-moss/40 bg-moss/10 px-3.5 py-1.5 text-[12px] font-medium text-moss">
                <span aria-hidden className="led led-moss" /> Backend connected
              </span>
            ) : conn === 'fail' ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-brick/40 bg-brick/10 px-3.5 py-1.5 text-[12px] font-medium text-brick">
                <span aria-hidden className="led led-oxide" /> Backend unreachable
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-1.5 text-[12px] font-medium text-faint">
                <span aria-hidden className="led" /> Not checked
              </span>
            )}
          </div>
        </div>
      </div>

      {showOverlay && <AssembleOverlay leaving={overlayLeaving} onGone={handleOverlayGone} />}
      {insight && (
        <InsightFlash reasoning={insight.reasoning} categories={insight.categories} onDone={finishInsight} />
      )}
    </div>
  )
}
