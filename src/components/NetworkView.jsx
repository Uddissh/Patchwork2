import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, MarkerType, Panel, ReactFlow } from '@xyflow/react'
import { animate, createTimeline, stagger } from 'animejs'
import SupplierNode from './flow/SupplierNode.jsx'
import LaneNode from './flow/LaneNode.jsx'
import AnimatedEdge from './flow/AnimatedEdge.jsx'
import DeadlineBadge from './DeadlineBadge.jsx'
import { api } from '../api.js'
import { describeError, endToEndDays, money, normalizeReplacement, normalizeSuppliers } from '../lib/normalize.js'
import { selectedSuppliers, supplierSelection } from '../lib/selection.js'
import { DUR, DRAMA_MS, EASE, edgeUnplug, flipHandoff, reducedMotion, tweenMoney } from '../lib/motion.js'
import { useMotionScope } from '../lib/useMotionScope.js'
import { Icon } from './Icons.jsx'

const nodeTypes = { supplier: SupplierNode, lane: LaneNode }
const edgeTypes = { animated: AnimatedEdge }

// Canvas rhythm: lanes every 340px; nodes sit inside their lane column.
// The critical path (selected supplier per stage) runs through the gutters.
const HORIZ = 340
const SLOT = 168

// Auto-repair demo cadence: while enabled, a failure is injected every 30s
// and the network heals itself. wallClock() stamps the orchestrator timeline.
const AUTO_SECONDS = 30
const wallClock = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

// Network option cards — shown once per session, before the user confirms.
const OPTION_BLURB = {
  Cheapest: 'Lowest total cost — may take longer.',
  Fastest: 'Shortest lead time — may cost more.',
  Balanced: 'Cheapest build that still fits your deadline.',
}
let optionsChosen = false // session flag: never re-nag after a pick or skip

const NEGOTIATION_EXAMPLES = ['Reduce cost by 20%', 'Deliver in 3 days', 'Use local suppliers']

/* ------------------------------------------------------------------ */
/* Confidence meter — ring sweeps 0→score while the number counts up.  */
/* Moss ≥ 80, amber ≥ 50, brick below.                                 */
/* ------------------------------------------------------------------ */
function ConfidenceRing({ score }) {
  const ringRef = useRef(null)
  const numRef = useRef(null)
  const R = 15.5
  const C = 2 * Math.PI * R
  const color =
    score >= 80
      ? 'var(--color-moss, #3e7a62)'
      : score >= 50
        ? 'var(--color-amber, #D97706)'
        : 'var(--color-brick, #a94438)'

  useEffect(() => {
    const ring = ringRef.current
    if (!ring) return undefined
    const clamped = Math.max(0, Math.min(100, score))
    const target = C * (1 - clamped / 100)
    if (reducedMotion()) {
      ring.style.strokeDashoffset = String(target)
      if (numRef.current) numRef.current.textContent = String(clamped)
      return undefined
    }
    const state = { v: 0 }
    const anims = [
      animate(ring, { strokeDashoffset: [C, target], duration: 900, ease: EASE.inOut }),
      animate(state, {
        v: clamped,
        duration: 900,
        ease: EASE.out,
        onUpdate: () => {
          if (numRef.current) numRef.current.textContent = String(Math.round(state.v))
        },
      }),
    ]
    return () => anims.forEach((a) => a?.cancel?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score])

  return (
    <div className="relative h-10 w-10" role="img" aria-label={`Network confidence ${score} of 100`}>
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90">
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--color-line)" strokeWidth="3.5" />
        <circle
          ref={ringRef}
          cx="20"
          cy="20"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C}
        />
      </svg>
      <span
        ref={numRef}
        className="metric absolute inset-0 grid place-items-center text-[12.5px] font-medium"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  )
}

// Edge marker colors — the critical path uses the product accent.
const MARKER = {
  chain: { on: '#e5560a', dim: 'rgba(229, 86, 10, 0.3)' },
  ok: { on: '#7faf93', dim: 'rgba(127, 175, 147, 0.3)' },
  warn: { on: '#d9b36a', dim: '#d9b36a' },
  crit: { on: '#d97757', dim: '#d97757' },
  cand: { on: 'rgba(242, 240, 233, 0.4)', dim: 'rgba(242, 240, 233, 0.4)' },
}

const LOG_TONE_CLASS = {
  chalk: 'log-line',
  crit: 'log-line-crit',
  moss: 'log-line-moss',
  accent: 'log-line-accent',
}

export default function NetworkView({ stages, suppliers, setSuppliers, form, assemblyRaw, onProceed, showToast }) {
  const [repairing, setRepairing] = useState(false)
  const [failureRoot, setFailureRoot] = useState(null) // victim key while disrupted
  const [lastRepaired, setLastRepaired] = useState(null)
  const [hoveredKey, setHoveredKey] = useState(null)
  const [assembling, setAssembling] = useState(() => !reducedMotion())
  const [logLines, setLogLines] = useState([])
  const [stakes, setStakes] = useState(null) // cost/lead delta after a repair
  // Auto-repair simulation: visible countdown → injected failure → self-heal.
  const [autoRepair, setAutoRepair] = useState(true)
  const [autoCount, setAutoCount] = useState(AUTO_SECONDS)
  const [autoPhase, setAutoPhase] = useState('idle') // counting | failing | healed
  const [healedIn, setHealedIn] = useState(null)
  // Pre-confirm network options: three priced builds fetched after assembly.
  const [options, setOptions] = useState(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chosenLabel, setChosenLabel] = useState(null)
  const optionsFetched = useRef(false)
  const timers = useRef([])
  const assemblyTl = useRef(null)
  const totalRef = useRef(null)
  const logRef = useRef(null)
  const prevTotal = useRef(0)
  const bootLogged = useRef(false)
  const repairBusy = useRef(false) // sync guard — repairing state is batched

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /* --------------------- selection (shared definition) --------------- */

  const selection = useMemo(() => supplierSelection(suppliers), [suppliers])
  const selected = useMemo(() => selectedSuppliers(suppliers), [suppliers])
  const confidence = Number.isFinite(assemblyRaw?.confidence) ? assemblyRaw.confidence : null

  /* ------------------------- assembly sequence ---------------------- */
  /* ~3s, cosmetic, runs off data already returned: lanes (stage names)  */
  /* appear one by one, then cards cascade per tier with quotes ticking  */
  /* up, while the log narrates. Edges draw themselves on mount, keyed   */
  /* to each tier. Click anywhere to skip.                               */

  const [rootRef] = useMotionScope((scope, root) => {
    try {
      if (reducedMotion()) {
        setAssembling(false)
        return
      }
      const tl = createTimeline({
        defaults: { ease: EASE.out, duration: DUR.base },
        onComplete: () => setAssembling(false),
      })
      const lanes = root.querySelectorAll('[data-lane]')
      const metrics = root.querySelectorAll('[data-metric-block]')
      const enters = root.querySelectorAll('[data-enter]')
      const cards = root.querySelectorAll('[data-node-card]')
      if (lanes.length) tl.add(lanes, { opacity: [0, 1], duration: 300, delay: stagger(160) })
      if (metrics.length) tl.add(metrics, { opacity: [0, 1], y: [10, 0], delay: stagger(70) }, '-=160')
      if (enters.length) tl.add(enters, { opacity: [0, 1], y: [10, 0], delay: stagger(70) }, '-=160')
      if (cards.length) {
        tl.add(
          cards,
          {
            opacity: [0, 1],
            y: [14, 0],
            duration: 440,
            delay: (el) => 900 + (Number(el.dataset.tier) || 0) * 170 + (Number(el.dataset.slot) || 0) * 60,
          },
          '-=200',
        )
      }
      assemblyTl.current = tl
    } catch {
      // Choreography must never take the view down with it.
      setAssembling(false)
    }
  }, [])

  const skipAssembly = () => {
    if (!assembling || !assemblyTl.current) return
    assemblyTl.current.complete()
    assemblyTl.current = null
    setAssembling(false)
  }

  /* ------------------------- orchestrator log ------------------------ */

  const pushLog = (text, tone = 'chalk', ts = null) =>
    setLogLines((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, text, tone, ts }])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    const last = el.lastElementChild
    if (last && !reducedMotion()) {
      animate(last, { opacity: [0, 1], x: [-6, 0], duration: 200, ease: EASE.out })
    }
  }, [logLines])

  useEffect(() => {
    if (bootLogged.current) return
    bootLogged.current = true
    const resolution = () => {
      const d = form?.deadline != null && form.deadline !== '' ? Number(form.deadline) : null
      const l = endToEndDays(selected)
      if (d != null && l != null && d > 0) {
        const over = l - d
        if (over <= 0) pushLog('Deadline fit: on time', 'moss')
        else pushLog(`Deadline fit: ${over} ${over === 1 ? 'day' : 'days'} over`, 'crit')
      } else {
        pushLog('Assembly complete', 'accent')
      }
    }
    const lines = [
      { at: 250, text: `Decomposed into ${stages.length} stage${stages.length === 1 ? '' : 's'}` },
      { at: 1050, text: `Matched ${selected.length} suppliers` },
      { at: 1850, text: 'Checking deadline...' },
    ]
    if (reducedMotion()) {
      lines.forEach((l) => pushLog(l.text))
      resolution()
      return
    }
    lines.forEach((l) => timers.current.push(setTimeout(() => pushLog(l.text), l.at)))
    timers.current.push(setTimeout(resolution, 2650))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------ auto-repair simulation ------------------- */
  /* While enabled: a visible 30s countdown, then an injected failure    */
  /* the network heals from on its own — the demo loop. Any repair (auto */
  /* or manual) pauses the countdown for its duration; after a self-heal */
  /* the healed badge lingers ~5s before the next cycle starts.          */

  useEffect(() => {
    if (
      !autoRepair ||
      repairing ||
      assembling ||
      optionsOpen ||
      suppliers.length === 0 ||
      autoPhase === 'healed'
    ) {
      setAutoPhase((p) => (p === 'counting' ? 'idle' : p))
      return undefined
    }
    setAutoCount(AUTO_SECONDS)
    setAutoPhase('counting')
    const iv = setInterval(() => setAutoCount((c) => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(iv)
  }, [autoRepair, repairing, assembling, optionsOpen, suppliers.length, autoPhase])

  useEffect(() => {
    if (autoRepair && autoPhase === 'counting' && autoCount === 0 && !repairing) {
      simulateFailure({ auto: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCount, autoPhase, autoRepair, repairing])

  /* ------------------------ network options chooser ------------------ */
  /* After assembly lands, fetch three priced builds and ask which one   */
  /* to confirm. Balanced is pre-highlighted; a pick (or skip) is final  */
  /* for the session so revisits never re-nag.                           */

  useEffect(() => {
    if (optionsChosen || optionsFetched.current || suppliers.length === 0) return
    optionsFetched.current = true
    const cats = [
      ...new Set(suppliers.map((s) => String(s.raw?.category ?? s.category)).filter(Boolean)),
    ]
    if (!cats.length) return
    api
      .assembleOptions({
        required_categories: cats,
        budget: form?.budget ?? null,
        deadline_days: form?.deadline ?? null,
        quantity: form?.quantity ?? null,
      })
      .then((list) => {
        if (optionsChosen || !Array.isArray(list) || list.length === 0) return
        setOptions(list)
        setOptionsOpen(true)
      })
      .catch(() => pushLog('Network options unavailable — keeping current build', 'chalk'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers.length])

  const [optionsRef] = useMotionScope((scope, root) => {
    if (reducedMotion()) return
    const head = root.querySelectorAll('[data-option-head]')
    const cards = root.querySelectorAll('[data-option-card]')
    if (head.length) animate(head, { opacity: [0, 1], y: [10, 0], duration: 340, ease: EASE.out })
    if (cards.length) {
      animate(cards, {
        opacity: [0, 1],
        y: [18, 0],
        duration: 440,
        delay: stagger(110),
        ease: EASE.out,
      })
    }
  }, [optionsOpen])

  const chooseOption = (opt) => {
    if (chosenLabel || !opt) return
    setChosenLabel(opt.label) // glow the picked card before it loads
    timers.current.push(
      setTimeout(() => {
        const normalized = normalizeSuppliers(opt.network, stages)
        if (normalized.length) setSuppliers(normalized)
        optionsChosen = true
        setOptionsOpen(false)
        setChosenLabel(null)
        pushLog(
          `${opt.label} network loaded — ${money(opt.total_cost)} · ${opt.max_days}d`,
          'accent',
          wallClock(),
        )
      }, 420),
    )
  }

  const skipOptions = () => {
    optionsChosen = true
    setOptionsOpen(false)
  }

  /* ------------------------ shared-element landing -------------------- */
  /* The budget readout from Request flies to the total-cost metric       */
  /* (FLIP: getBoundingClientRect before/after, ghost clone animated).    */
  useEffect(() => {
    const src = flipHandoff.current
    flipHandoff.current = null
    if (!src || reducedMotion()) return undefined
    const target = totalRef.current
    if (!target) return undefined
    const tr = target.getBoundingClientRect()
    if (!tr.width || !src.rect?.width) return undefined
    const ghost = document.createElement('div')
    ghost.textContent = src.text
    ghost.setAttribute('aria-hidden', 'true')
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${src.rect.left}px`,
      top: `${src.rect.top}px`,
      zIndex: 45,
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      padding: '2px 7px',
      borderRadius: '4px',
      background: 'var(--color-paper)',
      boxShadow: '0 1px 10px rgba(20, 20, 20, 0.14)',
      font: '600 15px/1.4 ui-sans-serif, system-ui, sans-serif',
      color: 'var(--color-ink)',
    })
    document.body.appendChild(ghost)
    const anim = animate(ghost, {
      x: tr.left - src.rect.left,
      y: tr.top - src.rect.top,
      scale: [1, Math.min(1.8, Math.max(1, tr.height / src.rect.height))],
      opacity: [1, 1, 0],
      duration: 720,
      ease: EASE.inOut,
      onComplete: () => ghost.remove(),
    })
    return () => {
      anim?.cancel?.()
      ghost.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------ metrics --------------------------- */

  const total = useMemo(
    () => selected.reduce((a, s) => a + (Number.isFinite(s.price) ? s.price : 0), 0),
    [selected],
  )
  const lead = useMemo(() => endToEndDays(selected), [selected])
  const deadline = form?.deadline != null && form.deadline !== '' ? Number(form.deadline) : null

  // The headline counter is driven imperatively (zero re-renders/frame);
  // React state stays the source of truth and the readout converges on it.
  useEffect(() => {
    tweenMoney(totalRef.current, prevTotal.current, total)
    prevTotal.current = total
  }, [total])

  /* --------------------------- flow graph --------------------------- */

  const laneNodes = useMemo(
    () =>
      stages.map((name, i) => {
        const count = suppliers.filter((s) => s.stageIndex === i).length
        return {
          id: `lane-${i}`,
          type: 'lane',
          draggable: false,
          selectable: false,
          connectable: false,
          deletable: false,
          position: { x: i * HORIZ - 40, y: -72 },
          zIndex: 0,
          data: { index: i, name, count, height: Math.max(150, count * SLOT + 112) },
        }
      }),
    [stages, suppliers],
  )

  // Why-line: one short line for a selected card, computed only from the
  // fields that already exist (price/days vs the stage's other suppliers).
  // Strictly best wins; ties and solo suppliers show nothing.
  const whyFor = (s) => {
    if (!selection.isSelected(s)) return null
    const peers = suppliers.filter((o) => o.stageIndex === s.stageIndex && o.key !== s.key)
    if (!peers.length) return null
    const fastest =
      s.days != null &&
      peers.some((o) => o.days != null && o.days > s.days) &&
      peers.every((o) => o.days == null || s.days < o.days)
    if (fastest) return 'Fastest in stage'
    const cheapest =
      s.price != null &&
      peers.some((o) => o.price != null && o.price > s.price) &&
      peers.every((o) => o.price == null || s.price < o.price)
    if (cheapest) return 'Lowest price in stage'
    return null
  }

  // Assembly rhythm shared by cards, quotes and edges: a card lands (and its
  // quote starts) at this delay; an edge draws only after BOTH of its cards
  // have fully appeared.
  const cardAppearDelay = (s) => (assembling ? 900 + (s.stageIndex ?? 0) * 170 + (s.slot ?? 0) * 60 : 0)

  const nodes = useMemo(
    () => [
      ...laneNodes,
      ...suppliers.map((s) => ({
        id: s.key,
        type: 'supplier',
        draggable: false,
        selectable: false,
        connectable: false,
        position: { x: s.stageIndex * HORIZ, y: (s.slot ?? 0) * SLOT + ((s.stageIndex % 2) * 12) },
        zIndex: 1,
        data: {
          supplier: s,
          stageName: stages[s.stageIndex] ?? s.category,
          selected: selection.isSelected(s),
          why: whyFor(s),
          // When the card lands during the assembly sequence, its quote
          // starts ticking at the same moment the card appears.
          appearDelay: cardAppearDelay(s),
          onHover: setHoveredKey,
        },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [laneNodes, suppliers, stages, selection, assembling],
  )

  const edges = useMemo(() => {
    const byStage = new Map()
    for (const s of suppliers) {
      const list = byStage.get(s.stageIndex) ?? []
      list.push(s)
      byStage.set(s.stageIndex, list)
    }
    const stageIdx = [...byStage.keys()].sort((a, b) => a - b)

    // The selected supplier of each stage — same helper as Checkout/Success.
    const chosen = new Map()
    for (const s of suppliers) {
      if (selection.isSelected(s)) chosen.set(s.stageIndex ?? 0, s)
    }

    const victim = failureRoot ? suppliers.find((s) => s.key === failureRoot) : null
    const hovered = hoveredKey ? suppliers.find((s) => s.key === hoveredKey) : null
    const out = []

    // Critical path: one bold edge between the selected suppliers of each
    // consecutive stage pair — routed through the lane gutter, so it never
    // crosses behind cards.
    for (let k = 0; k < stageIdx.length - 1; k++) {
      const a = chosen.get(stageIdx[k])
      const b = chosen.get(stageIdx[k + 1])
      if (!a || !b) continue
      let state = 'nominal'
      let warnDelay = 0
      if (victim) {
        if (a === victim || b === victim) {
          state = 'crit'
        } else if (stageIdx[k] > victim.stageIndex) {
          // Downstream routes degrade in a staggered ripple per hop.
          state = 'warn'
          warnDelay = (stageIdx[k] - victim.stageIndex) * 90
        }
      } else if (a.status === 'repaired' || b.status === 'repaired') {
        state = 'ok'
      }
      const emphasis = hovered && a.key !== hovered.key && b.key !== hovered.key ? 'dim' : null
      const markerKey = state === 'nominal' ? 'chain' : state
      out.push({
        id: `${a.key}=>${b.key}`,
        source: a.key,
        target: b.key,
        type: 'animated',
        zIndex: 1,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: MARKER[markerKey][emphasis === 'dim' ? 'dim' : 'on'],
          width: 13,
          height: 13,
        },
        data: {
          state,
          chain: true,
          emphasis,
          warnDelay,
          // Draw only after both endpoint cards have fully appeared.
          drawDelay: Math.max(cardAppearDelay(a), cardAppearDelay(b)) + (assembling ? 480 : 280),
        },
      })
    }

    // Route inspection: hovering any supplier reveals faint dashed links to
    // the selected suppliers of the adjacent stages (its candidate routings).
    if (hovered) {
      const addCandidate = (from, to) => {
        if (!from || !to || from.key === to.key) return
        if (chosen.get(from.stageIndex) === from && chosen.get(to.stageIndex) === to) return // already the chain edge
        out.push({
          id: `cand-${from.key}=>${to.key}`,
          source: from.key,
          target: to.key,
          type: 'animated',
          zIndex: 1,
          markerEnd: { type: MarkerType.ArrowClosed, color: MARKER.cand.on, width: 11, height: 11 },
          data: { state: 'cand', instant: true },
        })
      }
      const up = chosen.get(hovered.stageIndex - 1)
      const down = chosen.get(hovered.stageIndex + 1)
      if (up) addCandidate(up, hovered)
      if (down) addCandidate(hovered, down)
    }

    return out
  }, [suppliers, failureRoot, hoveredKey, selection, assembling])

  /* --------------------------- negotiation --------------------------- */

  const [negotiateOpen, setNegotiateOpen] = useState(false)
  const [negotiateInput, setNegotiateInput] = useState('')
  const [negotiating, setNegotiating] = useState(false)
  const [negotiation, setNegotiation] = useState(null)
  const [negotiateError, setNegotiateError] = useState(null)
  const negPanelRef = useRef(null)

  // Slide the drawer down on open (height 0 → measured → auto).
  useEffect(() => {
    const el = negPanelRef.current
    if (!negotiateOpen || !el || reducedMotion()) return undefined
    const h = el.scrollHeight
    el.style.overflow = 'hidden'
    const anim = animate(el, {
      height: [0, h],
      opacity: [0, 1],
      duration: 340,
      ease: EASE.out,
      onComplete: () => {
        el.style.height = 'auto'
        el.style.overflow = ''
      },
    })
    return () => anim?.cancel?.()
  }, [negotiateOpen])

  const closeNegotiation = () => {
    const el = negPanelRef.current
    if (!el || reducedMotion()) {
      setNegotiateOpen(false)
      return
    }
    el.style.overflow = 'hidden'
    animate(el, {
      height: [el.scrollHeight, 0],
      opacity: [1, 0],
      duration: 260,
      ease: EASE.in,
      onComplete: () => setNegotiateOpen(false),
    })
  }

  async function runNegotiation() {
    const constraint = negotiateInput.trim()
    if (negotiating || !constraint) return
    setNegotiating(true)
    setNegotiation(null)
    setNegotiateError(null)
    try {
      const res = await api.negotiate({
        network: suppliers.map((s) => s.raw ?? s),
        constraint,
      })
      setNegotiation(res ?? {})
    } catch (err) {
      setNegotiateError(describeError(err))
    } finally {
      setNegotiating(false)
    }
  }

  // Apply the LLM's suggestion: reroute the selected supplier in the
  // suggested category through the same repair flow (it picks the
  // cheapest available replacement — the orchestrator's actual move).
  const applyNegotiation = () => {
    const cat = negotiation?.swap_category
    if (!cat) return
    const victim =
      suppliers.find((s) => s.category === cat && selection.isSelected(s)) ??
      suppliers.find((s) => s.category === cat)
    if (!victim) {
      showToast('error', `No ${cat} supplier in the current network to swap.`)
      return
    }
    closeNegotiation()
    simulateFailure({ victim })
  }

  /* --------------------- failure / reroute sequence ------------------ */

  const patch = (key, fields) =>
    setSuppliers((prev) => prev.map((s) => (s.key === key ? { ...s, ...fields } : s)))

  const wait = (ms) => new Promise((resolve) => timers.current.push(setTimeout(resolve, ms)))

  // Links incident to the victim, with the end that unplugs first.
  const incidentEdges = (victim) => [
    ...suppliers
      .filter((s) => s.stageIndex === victim.stageIndex - 1 && selection.isSelected(s))
      .map((s) => ({ id: `${s.key}=>${victim.key}`, brokenEnd: 'end' })),
    ...suppliers
      .filter((s) => s.stageIndex === victim.stageIndex + 1 && selection.isSelected(s))
      .map((s) => ({ id: `${victim.key}=>${s.key}`, brokenEnd: 'start' })),
  ]

  async function simulateFailure({ auto = false, victim: victimArg = null } = {}) {
    if (repairBusy.current || repairing || suppliers.length === 0) return
    repairBusy.current = true
    const startedAt = performance.now()
    setHoveredKey(null)
    setRepairing(true)
    if (auto) setAutoPhase('failing')
    const victim = victimArg ?? suppliers[Math.floor(Math.random() * suppliers.length)]
    // Stakes baseline — real before/after arithmetic on the selected set.
    // Alternatives sit outside the selected chain, so if one fails the
    // totals are untouched by definition.
    const victimWasSelected = selection.isSelected(victim)
    const preTotal = total
    const preLead = lead
    setStakes(null)

    // Orchestrator log — cleared on every run, synced to the real stages.
    setLogLines([])
    pushLog(`${victim.name} marked unavailable`, 'crit', wallClock())
    timers.current.push(setTimeout(() => pushLog('Finding replacement...'), 350))

    setFailureRoot(victim.key)
    patch(victim.key, { status: 'failing' })
    showToast('error', `${victim.name} went down — searching for a replacement…`)

    const minDrama = wait(DRAMA_MS) // readable minimum, never fake progress

    let replacement = null
    let repairMeta = null // { explanation, impact } from the LLM-enhanced /repair
    try {
      const res = await api.repair({
        failed_node_id: victim.id,
        node_id: victim.key,
        failed_supplier: victim.raw ?? victim,
        network: suppliers.map((s) => s.raw ?? s),
        context: {
          budget: form?.budget ?? null,
          deadline: form?.deadline ?? null,
          quantity: form?.quantity ?? null,
        },
      })
      replacement = normalizeReplacement(res)
      repairMeta =
        res?.explanation || res?.impact
          ? { explanation: res?.explanation ?? null, impact: res?.impact ?? null }
          : null
    } catch (err) {
      await minDrama
      repairBusy.current = false
      patch(victim.key, { status: 'idle' })
      setFailureRoot(null)
      setRepairing(false)
      pushLog('Repair failed — network unchanged', 'crit')
      showToast('error', `Repair failed — ${describeError(err)}`)
      return
    }

    const altCount = suppliers.filter(
      (s) => s.stageIndex === victim.stageIndex && s.key !== victim.key,
    ).length
    pushLog(`Evaluating ${altCount} alternative${altCount === 1 ? '' : 's'}`)
    pushLog(`Replacement found: ${replacement?.name ?? '—'}`, 'chalk', wallClock())

    await minDrama

    timers.current.push(
      setTimeout(() => pushLog(`Re-routing ${stages[victim.stageIndex] ?? victim.category ?? 'stage'}`, 'accent'), 200),
    )

    // Dissolve the failed supplier and unplug its links from the broken end.
    if (!reducedMotion()) {
      const root = rootRef.current
      const card = root?.querySelector(`[data-node-key="${CSS.escape(victim.key)}"]`)
      if (card) {
        animate(card, {
          opacity: [1, 0],
          x: [0, -14],
          duration: 300,
          ease: EASE.inOut,
        })
      }
      for (const e of incidentEdges(victim)) {
        const path = root?.querySelector(`[data-edge-id="${CSS.escape(e.id)}"]`)
        if (path) edgeUnplug(path, { from: e.brokenEnd, duration: 260 })
      }
    }
    await wait(340)

    // Slot the replacement into the exact coordinates the victim held —
    // the position derives deterministically from stage/slot, so the
    // replacement inherits the victim's selection role. Its card and links
    // animate in; the totals tween to the new state of the network.
    const nextSuppliers = suppliers.map((s) => {
      if (s.key !== victim.key) return s
      return {
        ...s,
        name: replacement?.name ?? `${s.name} (backup)`,
        price: replacement?.price ?? s.price,
        days: replacement?.days ?? s.days,
        id: replacement?.id ?? s.id,
        key: `${s.key}-fx-${Date.now()}`,
        status: 'repaired',
      }
    })
    setSuppliers(nextSuppliers)

    // Failure stakes — the true before/after delta on the selected set.
    // Only meaningful when the failed supplier was part of that set; when a
    // bare alternative fails, the chain and totals are untouched by
    // definition, so no delta line is shown.
    const nextSelected = selectedSuppliers(nextSuppliers)
    const nextTotal = nextSelected.reduce((a, s) => a + (Number.isFinite(s.price) ? s.price : 0), 0)
    const nextLead = endToEndDays(nextSelected)
    if (victimWasSelected) {
      setStakes({
        costDelta: nextTotal - preTotal,
        daysDelta: nextLead != null && preLead != null ? nextLead - preLead : null,
      })
    } else {
      setStakes(null)
    }

    setFailureRoot(null)
    setRepairing(false)
    setLastRepaired(replacement?.name ?? victim.name)
    pushLog(`Network rebalanced. New total: ${money(nextTotal)}`, 'moss', wallClock())
    const healedSecs = ((performance.now() - startedAt) / 1000).toFixed(1)
    if (auto) {
      setHealedIn(healedSecs)
      setAutoPhase('healed')
      // Let the healed badge breathe before the next countdown cycle begins.
      timers.current.push(setTimeout(() => setAutoPhase('counting'), 5000))
      pushLog(`Network self-healed in ${healedSecs}s`, 'moss')
      showToast('success', `Network self-healed in ${healedSecs}s — ${replacement?.name ?? 'a backup supplier'} took over.`, repairMeta)
    } else {
      pushLog('Network repaired', 'moss')
      showToast('success', `Network repaired — ${replacement?.name ?? 'a backup supplier'} took over.`, repairMeta)
    }
    if (!victimWasSelected) pushLog('Backup supplier replaced, chain unaffected', 'moss')
    timers.current.push(setTimeout(() => setLastRepaired(null), 4500))
    repairBusy.current = false
  }

  const hovered = hoveredKey ? suppliers.find((s) => s.key === hoveredKey) : null
  const hoveredRoute = hovered
    ? {
        name: hovered.name,
        up: suppliers.filter((s) => s.stageIndex === hovered.stageIndex - 1 && selection.isSelected(s)).length,
        down: suppliers.filter((s) => s.stageIndex === hovered.stageIndex + 1 && selection.isSelected(s)).length,
      }
    : null

  const statusDot = repairing ? 'led-oxide led-pulse' : lastRepaired ? 'led-accent' : 'led-moss'
  const statusText = repairing
    ? '🔄 Repairing network…'
    : lastRepaired
      ? `Rerouted — ${lastRepaired}`
      : 'All suppliers nominal'
  const statusClass = repairing ? 'text-[#d97757]' : lastRepaired ? 'text-[#e5560a]' : 'text-moss'

  return (
    <div
      ref={rootRef}
      onClick={skipAssembly}
      className="mx-auto flex w-full max-w-[1500px] flex-col px-6 pb-5 pt-4 lg:h-[calc(100vh-3.5rem)] lg:min-h-[680px] lg:px-10 lg:pt-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="kicker">02 — Network</p>
          <h1 className="mt-2 font-display text-[28px] font-medium leading-tight tracking-[-0.01em] text-ink">
            Supplier network
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] font-medium text-secondary">
            <input
              type="checkbox"
              checked={autoRepair}
              onChange={(e) => setAutoRepair(e.target.checked)}
              className="h-3.5 w-3.5 accent-forest"
            />
            Auto-repair simulation
          </label>
          {autoRepair && !repairing && !assembling && suppliers.length > 0
            && (autoPhase === 'counting' || autoPhase === 'healed') && (
            <span className="metric inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-[11px] text-secondary">
              <span
                aria-hidden
                className={`led ${autoPhase === 'healed' ? 'led-moss' : 'led-oxide led-pulse'}`}
              />
              {autoPhase === 'healed'
                ? `✓ Network self-healed in ${healedIn ?? '—'}s`
                : `Supplier failure simulation in: ${autoCount}s`}
            </span>
          )}
          <button
            type="button"
            onClick={() => (negotiateOpen ? closeNegotiation() : setNegotiateOpen(true))}
            disabled={repairing}
            className="btn btn-quiet"
          >
            <Icon name="sparkle" className="h-3.5 w-3.5" />
            Negotiate
          </button>
          <button
            type="button"
            onClick={() => simulateFailure()}
            disabled={repairing || suppliers.length === 0}
            className="btn btn-danger"
          >
            <Icon name="bolt" className="h-3.5 w-3.5" />
            {repairing ? 'Rerouting…' : 'Simulate failure'}
          </button>
          <button type="button" onClick={onProceed} disabled={repairing} className="btn btn-primary">
            Proceed to checkout
            <Icon name="arrow" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* negotiation drawer — slides down inline, no modal */}
      {negotiateOpen && (
        <div ref={negPanelRef} className="overflow-hidden">
          <div className="panel mt-4 p-5">
            <div className="flex items-baseline justify-between gap-4">
              <p className="kicker">Negotiate with orchestrator</p>
              <button
                type="button"
                onClick={closeNegotiation}
                aria-label="Dismiss negotiation panel"
                className="text-faint transition hover:text-secondary"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                runNegotiation()
              }}
            >
              <input
                value={negotiateInput}
                onChange={(e) => setNegotiateInput(e.target.value)}
                placeholder="What constraint do you want to apply?"
                className="field min-w-[240px] flex-1"
              />
              <button type="submit" disabled={negotiating || !negotiateInput.trim()} className="btn btn-primary">
                {negotiating ? (
                  <>
                    <Icon name="spinner" className="h-4 w-4 animate-spin" />
                    Orchestrator negotiating…
                  </>
                ) : (
                  'Apply constraint'
                )}
              </button>
            </form>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-faint">Try:</span>
              {NEGOTIATION_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setNegotiateInput(ex)}
                  className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] text-secondary transition hover:border-ink hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
            {negotiateError && (
              <p role="alert" className="mt-3 border-l-2 border-brick pl-3 text-[12.5px] leading-relaxed text-brick">
                {negotiateError}
              </p>
            )}
            {negotiation && (
              <div className="mt-4 border-t border-line-soft pt-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {negotiation.swap_category && <span className="stage-tag">{negotiation.swap_category}</span>}
                  <p className="text-[14.5px] font-semibold text-ink">
                    {negotiation.suggestion ?? 'No suggestion returned.'}
                  </p>
                </div>
                {negotiation.reasoning && (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-secondary">{negotiation.reasoning}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applyNegotiation}
                    disabled={repairing || negotiating || !negotiation.swap_category}
                    className="btn btn-primary"
                  >
                    Apply suggestion
                  </button>
                  <button type="button" onClick={closeNegotiation} className="btn btn-quiet">
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* metrics strip — totals follow the shared selection definition */}
      <div className="mt-4 border-y border-line">
        <div className="flex flex-wrap items-stretch divide-x divide-line-soft">
          <div data-metric-block className="py-2.5 pr-6">
            <p className="text-[12px] font-medium text-secondary">Total network cost</p>
            <p ref={totalRef} className="metric mt-1 text-[24px] font-medium leading-none text-ink" />
          </div>
          <div data-metric-block className="px-6 py-2.5">
            <p className="text-[12px] font-medium text-secondary">Selected / Stages</p>
            <p className="metric mt-1 text-[16px] leading-none text-ink">
              {selected.length}
              <span className="text-faint"> / </span>
              {stages.length || '—'}
            </p>
          </div>
          <div data-metric-block className="px-6 py-2.5">
            <p className="text-[12px] font-medium text-secondary">Est. end-to-end lead</p>
            <p className="metric mt-1 text-[16px] leading-none text-ink">
              {lead != null ? `${lead} days` : '—'}
            </p>
          </div>
          {deadline != null && (
            <div data-metric-block className="flex items-center px-6 py-2.5">
              <div>
                <p className="text-[12px] font-medium text-secondary">Deadline fit</p>
                <div className="mt-1">
                  <DeadlineBadge lead={lead} deadline={deadline} still={Boolean(stakes)} />
                </div>
                {stakes && (
                  <p className="metric mt-1 text-[11.5px] text-ink">
                    {stakes.costDelta === 0 && (stakes.daysDelta == null || stakes.daysDelta === 0)
                      ? 'No change to total'
                      : [
                          `${stakes.costDelta >= 0 ? '+' : '-'}${money(Math.abs(stakes.costDelta))}`,
                          stakes.daysDelta != null && stakes.daysDelta !== 0
                            ? `${stakes.daysDelta >= 0 ? '+' : '-'}${Math.abs(stakes.daysDelta)} ${
                                Math.abs(stakes.daysDelta) === 1 ? 'day' : 'days'
                              }`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </p>
                )}
              </div>
            </div>
          )}
          {confidence != null && (
            <div data-metric-block className="flex items-center px-6 py-2.5">
              <div>
                <ConfidenceRing score={confidence} />
                <p className="mt-1 text-[12px] font-medium text-secondary">Network confidence</p>
              </div>
            </div>
          )}
          <div data-metric-block className="flex items-center px-6 py-2.5">
            <p className={`inline-flex items-center gap-2.5 text-[13px] font-medium ${statusClass}`}>
              <span aria-hidden className={`led ${statusDot}`} />
              {statusText}
            </p>
          </div>
        </div>
      </div>

      {/* LLM network summary — one line on why this build holds together */}
      {assemblyRaw?.summary && (
        <div data-enter className="mt-4 flex items-start gap-3 border-l-2 border-[#e5560a] bg-paper px-4 py-3">
          <Icon name="sparkle" className="mt-0.5 h-4 w-4 flex-none text-[#e5560a]" />
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">{assemblyRaw.summary}</p>
          {assemblyRaw?.risk && (
            <span className="ml-3 flex-none whitespace-nowrap rounded-full border border-amber-600/40 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-700">
              ⚠ {assemblyRaw.risk}
            </span>
          )}
        </div>
      )}

      {/* the operations room — fills the remaining viewport height */}
      <div
        className={`canvas-frame relative mt-4 h-[60vh] lg:h-auto lg:min-h-0 lg:flex-1${
          assembling ? ' assembly-pending' : ''
        }`}
      >
        <span aria-hidden className="canvas-marks absolute inset-0" />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.4}
          maxZoom={1.5}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(242,240,233,0.09)" />
          <Controls position="bottom-right" showInteractive={false} />
          <Panel position="top-right">
            {hoveredRoute && (
              <div className="route-readout">
                <span className="text-chalk">{hoveredRoute.name}</span>
                <span className="text-chalk/45">·</span>
                <span>
                  {hoveredRoute.up} upstream · {hoveredRoute.down} downstream
                </span>
              </div>
            )}
          </Panel>
        </ReactFlow>
      </div>

      {/* orchestrator log — types the failure sequence as it happens */}
      <div className="mt-4 flex h-40 flex-none flex-col overflow-hidden rounded-sm border border-ink bg-canvas">
        <div className="flex flex-none items-center justify-between border-b border-chalk/10 px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-chalk/55">
            Orchestrator log
          </span>
          <span className="hidden font-mono text-[10px] text-chalk/30 lg:inline">
            hover a supplier to trace routes · click anywhere to skip assembly
          </span>
          <span className="metric text-[10px] text-chalk/35">
            {logLines.length > 0 ? `${logLines.length} events` : 'idle'}
          </span>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-2.5 font-mono text-[11.5px] leading-relaxed">
          {logLines.length === 0 ? (
            <p className="log-line text-chalk/35">No events — network nominal.</p>
          ) : (
            logLines.map((l) => (
              <p key={l.id} className={LOG_TONE_CLASS[l.tone] ?? 'log-line'}>
                <span aria-hidden className="mr-2 text-chalk/30">
                  ›
                </span>
                {l.ts && <span className="mr-2 text-chalk/40">{l.ts} —</span>}
                {l.text}
              </p>
            ))
          )}
        </div>
      </div>

      {/* pre-confirm chooser — three priced ways to build this network */}
      {optionsOpen && options && (
        <div
          ref={optionsRef}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a network option"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/80 px-4 py-10 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-3xl">
            <div data-option-head>
              <p className="kicker text-chalk">Pick a build</p>
              <h2 className="mt-2 font-display text-[24px] font-medium tracking-[-0.01em] text-chalk">
                Three ways to assemble this network
              </h2>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {options.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  data-option-card=""
                  onClick={() => chooseOption(opt)}
                  className={`panel flex flex-col p-5 text-left transition-transform duration-200 hover:-translate-y-1 ${
                    chosenLabel === opt.label
                      ? 'border-2 border-[#e5560a] shadow-[0_0_30px_rgba(229,86,10,0.45)]'
                      : opt.label === 'Balanced'
                        ? 'border-2 border-[#e5560a]/50'
                        : 'border border-line'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="stage-tag">{opt.label}</span>
                    {opt.label === 'Balanced' && !chosenLabel && (
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#e5560a]">
                        Recommended
                      </span>
                    )}
                  </span>
                  <span className="metric mt-4 text-[26px] font-medium leading-none text-ink">
                    {money(opt.total_cost)}
                  </span>
                  <span className="metric mt-1.5 text-[11.5px] text-secondary">
                    {opt.max_days} days · {opt.network?.length ?? 0} suppliers
                  </span>
                  <span className="mt-3 text-[11.5px] leading-snug text-secondary">
                    {OPTION_BLURB[opt.label] ?? ''}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5 text-center">
              <button type="button" onClick={skipOptions} className="btn btn-quiet">
                Keep current network
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
