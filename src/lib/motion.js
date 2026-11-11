import { animate, set } from 'animejs'
import { money } from './normalize.js'

/* ------------------------------------------------------------------ */
/* PATCHWORK motion primitives — the single source of motion truth.    */
/* Every view choreography routes through these tokens and helpers.    */
/* ------------------------------------------------------------------ */

export const DUR = {
  instant: 90,
  fast: 180,
  base: 320,
  slow: 560,
  draw: 640,
}

// Eases are plain strings — verified against animejs 4.5 runtime exports.
export const EASE = {
  out: 'outExpo', // entrances, settles
  inOut: 'inOutQuad', // mechanical moves, line draws
  in: 'inQuad', // exits, retractions
}

// Display-floor for the failure→replacement sequence so the UI never
// flashes through states faster than they can be read. This is a minimum
// render duration, never a fake progress indicator.
export const DRAMA_MS = 1100

export function reducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ------------------------------ edges ----------------------------- */

/**
 * Draw an SVG path from its source end to its target end.
 * Uses the dasharray/offset technique so the exact rendered path length
 * is honoured even after React Flow recomputes the geometry.
 * The `edge-undrawn` class (opacity: 0) is removed here, so the line is
 * never visible before its draw actually begins.
 */
export function edgeDrawIn(pathEl, { delay = 0, duration = DUR.draw, endDash = '' } = {}) {
  if (!pathEl) return null
  if (reducedMotion()) {
    pathEl.classList.remove('edge-undrawn')
    pathEl.style.strokeDasharray = endDash
    return null
  }
  const L = pathEl.getTotalLength()
  set(pathEl, { strokeDasharray: `${L} ${L}`, strokeDashoffset: L, opacity: 1 })
  return animate(pathEl, {
    strokeDashoffset: [L, 0],
    duration,
    delay,
    ease: EASE.inOut,
    onComplete: () => {
      pathEl.classList.remove('edge-undrawn')
      pathEl.style.strokeDasharray = endDash
      pathEl.style.strokeDashoffset = ''
    },
  })
}

/**
 * Retract a drawn edge toward one of its ends.
 * `from: 'start'` empties the source side first (used when the source
 * supplier is the failed node); `from: 'end'` the opposite.
 */
export function edgeUnplug(pathEl, { from = 'end', duration = 260 } = {}) {
  if (!pathEl || reducedMotion()) return null
  const L = pathEl.getTotalLength()
  set(pathEl, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 })
  return animate(pathEl, {
    strokeDashoffset: from === 'end' ? [0, L] : [0, -L],
    duration,
    ease: EASE.in,
  })
}

/* --------------------------- shared element ------------------------ */

/**
 * FLIP handoff for the Request → Network flight: RequestView drops the
 * budget readout's rect here; NetworkView picks it up on mount and flies a
 * ghost clone to the total-cost metric. One shot, then cleared.
 */
export const flipHandoff = { current: null }

/* ----------------------------- counters --------------------------- */

/**
 * Animate a monetary readout on a DOM ref. React never renders the value,
 * so there are zero re-renders per frame; the element's text is driven
 * imperatively and the final value always matches the real state.
 */
export function tweenMoney(el, from, to, { duration = 860, delay = 0 } = {}) {
  if (!el) return
  const target = Number.isFinite(to) ? to : null
  if (reducedMotion() || target === null) {
    el.textContent = target === null ? '—' : money(target)
    return
  }
  const state = { v: Number.isFinite(from) ? from : 0 }
  animate(state, {
    v: target,
    duration,
    delay,
    ease: EASE.out,
    onUpdate: () => {
      el.textContent = money(Math.round(state.v * 100) / 100)
    },
    onComplete: () => {
      el.textContent = money(target)
    },
  })
}
