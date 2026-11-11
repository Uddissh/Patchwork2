import { useEffect, useRef, useState } from 'react'
import { usePageTransition } from '../lib/usePageTransition.js'

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

/**
 * Macro page transitions. The parent passes an element for EVERY view; this
 * wrapper owns which one is on stage:
 *
 *   view change → EXIT on the current view → swap (scroll resets here) →
 *   → double-rAF (new view commits) → ENTER on the new view.
 *
 * The outgoing view keeps receiving live props while it exits, and reduced
 * motion collapses the whole sequence to an instant swap.
 */
export default function PageTransitionWrapper({ viewKey, views }) {
  const [shown, setShown] = useState(viewKey)
  const shownRef = useRef(viewKey)
  const targetRef = useRef(viewKey)
  const busyRef = useRef(false)
  const stageRef = useRef(null)
  const { transitionOut, transitionIn, setIsTransitioning } = usePageTransition()

  useEffect(() => {
    targetRef.current = viewKey
    if (busyRef.current || viewKey === shownRef.current) return undefined
    ;(async () => {
      busyRef.current = true
      setIsTransitioning(true)
      try {
        // A navigation click mid-flight only updates targetRef; the loop
        // folds it in on the next iteration instead of racing it.
        while (shownRef.current !== targetRef.current) {
          const prev = shownRef.current
          const next = targetRef.current
          await transitionOut(stageRef.current, prev, next)
          shownRef.current = next
          setShown(next)
          window.scrollTo(0, 0) // reset scroll while the stage is empty
          await nextFrame() // let the new view commit before its enter
          await transitionIn(stageRef.current, prev, next)
        }
      } finally {
        busyRef.current = false
        setIsTransitioning(false)
      }
    })()
    return undefined
  }, [viewKey, transitionOut, transitionIn, setIsTransitioning])

  return (
    <div ref={stageRef} className="will-change-transform" style={{ transformOrigin: 'top center' }}>
      {views[shown] ?? null}
    </div>
  )
}
