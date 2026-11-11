import { useState } from 'react'
import { animate } from 'animejs'
import { EASE, reducedMotion } from './motion.js'

/* ------------------------------------------------------------------ */
/* Cinematic page-transition definitions, keyed "prev->next". The      */
/* wrapper sequences exit → mount → enter through Promises; reduced    */
/* motion resolves instantly.                                          */
/* ------------------------------------------------------------------ */

const TRANSITIONS = {
  // Request → Network: slide through, as if walking into the ops room.
  'request->network': {
    exit: { x: [0, -56], opacity: [1, 0], duration: 300, ease: EASE.in },
    enter: { x: [56, 0], opacity: [0, 1], duration: 400, ease: EASE.out },
  },
  // Network → Checkout: the network compresses into a payment slip.
  'network->checkout': {
    exit: { scaleY: [1, 0.95], opacity: [1, 0], duration: 250, ease: EASE.in },
    enter: { y: [36, 0], opacity: [0, 1], duration: 400, ease: EASE.out },
  },
  // Checkout → Request: starting over, gently.
  'checkout->request': {
    exit: { scale: [1, 0.97], opacity: [1, 0], duration: 200, ease: EASE.in },
    enter: { y: [24, 0], opacity: [0, 1], duration: 350, ease: EASE.out },
  },
  // Network → Request: stepping back out of the ops room.
  'network->request': {
    exit: { x: [0, 56], opacity: [1, 0], duration: 300, ease: EASE.in },
    enter: { x: [-56, 0], opacity: [0, 1], duration: 350, ease: EASE.out },
  },
}

// Any unmapped pair (e.g. →success) gets a quiet crossfade.
const FALLBACK = {
  exit: { opacity: [1, 0], y: [0, -12], duration: 240, ease: EASE.in },
  enter: { opacity: [0, 1], y: [12, 0], duration: 320, ease: EASE.out },
}

const lookup = (prev, next) => TRANSITIONS[`${prev}->${next}`] ?? FALLBACK

// Run one animation and resolve when it truly completes. onComplete is the
// sequencer (no setTimeout guessing); the timeout is a one-shot watchdog so
// a wedged animation can never stall navigation.
function run(el, props) {
  return new Promise((resolve) => {
    if (!el || reducedMotion()) return resolve()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    animate(el, { ...props, onComplete: finish })
    setTimeout(finish, (props.duration ?? 300) + 160)
  })
}

/**
 * Transition primitives for the page orchestrator. The prev→next pair is
 * resolved at call time rather than hook-argument time, so the wrapper can
 * chain an exit and an enter for whatever navigation happens mid-flight.
 */
export function usePageTransition() {
  const [isTransitioning, setIsTransitioning] = useState(false)
  return {
    isTransitioning,
    setIsTransitioning,
    transitionOut: (el, prev, next) => run(el, lookup(prev, next).exit),
    transitionIn: (el, prev, next) => run(el, lookup(prev, next).enter),
  }
}
