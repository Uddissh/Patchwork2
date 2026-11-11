import { useEffect, useRef } from 'react'
import { createScope } from 'animejs'
import { reducedMotion } from './motion.js'

/**
 * React ⇄ Anime.js v4 bridge.
 *
 * Creates an Anime.js Scope rooted at the returned `rootRef` element and
 * runs `setup(scope, root)` inside it. Every animation/timeline created
 * synchronously in `setup` is registered on the scope; `scope.revert()`
 * in the effect cleanup reverts them all — no orphaned animations, no
 * DOM desync on unmount or dependency change.
 *
 * `setup` may return its own cleanup function.
 *
 * Usage:
 *   const [rootRef] = useMotionScope((scope, root) => { … }, [])
 */
export function useMotionScope(setup, deps = []) {
  const rootRef = useRef(null)
  const scopeRef = useRef(null)
  const setupRef = useRef(setup)

  useEffect(() => {
    setupRef.current = setup
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: '(prefers-reduced-motion: reduce)' },
    })
    scopeRef.current = scope
    let ownCleanup
    scope.add((s) => {
      ownCleanup = setupRef.current?.(s, root)
    })
    return () => {
      try {
        ownCleanup?.(scope)
      } catch {
        /* cleanup must never mask the revert */
      }
      scope.revert()
      scopeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return [rootRef, scopeRef]
}

export { reducedMotion }
