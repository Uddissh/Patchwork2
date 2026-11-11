import { memo, useEffect, useMemo, useRef } from 'react'
import { getSmoothStepPath } from '@xyflow/react'
import { edgeDrawIn, reducedMotion } from '../../lib/motion.js'

/**
 * Custom React Flow edge — ONE path per connection.
 *
 * Safety rules honoured here:
 *  - Anime.js only ever touches THIS path element (owned by this edge),
 *    never React Flow's viewport or node wrappers.
 *  - The edge draws itself once on mount (assembly choreography), using
 *    `data.drawDelay` so each supply tier's links draw as that tier
 *    settles. Chain edges then run their flow animation on the same path
 *    (CSS class `chain` — dash pattern + offset keyframes, no parallel
 *    line). Re-renders only restyle via the `edge-path` state class —
 *    in-flight draws are never restarted.
 *  - `data-edge-id` lets the network view imperatively unplug exactly the
 *    failed supplier's links during rerouting.
 *  - `data.state: 'cand'` + `data.instant` renders the faint dashed
 *    candidate routes shown while inspecting an alternative supplier.
 */
function AnimatedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const pathD = useMemo(
    () =>
      getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 10,
      }),
    [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition],
  )

  const pathRef = useRef(null)
  const drawStartedRef = useRef(false)

  // Stroke state + hover emphasis. Warn states arrive staggered along
  // downstream routes via `data.warnDelay` (hop distance from the failure).
  useEffect(() => {
    const el = pathRef.current
    if (!el) return undefined
    const state = data?.state ?? 'nominal'
    const chain = Boolean(data?.chain) && (state === 'nominal' || state === 'ok')
    const emphasis = data?.emphasis ?? null
    const apply = () => {
      el.setAttribute(
        'class',
        `edge-path${state !== 'nominal' ? ` ${state}` : ''}${chain ? ' chain' : ''}${
          emphasis ? ` ${emphasis}` : ''
        }${drawStartedRef.current ? '' : ' edge-undrawn'}`,
      )
    }
    if (state === 'warn' && data?.warnDelay > 0 && !emphasis) {
      const t = setTimeout(apply, data.warnDelay)
      return () => clearTimeout(t)
    }
    apply()
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathD, data?.state, data?.chain, data?.warnDelay, data?.emphasis])

  // One-time draw on mount. Hover candidate edges (`instant`) appear
  // immediately — no draw choreography while inspecting.
  useEffect(() => {
    const el = pathRef.current
    if (!el) return undefined
    drawStartedRef.current = true
    if (data?.instant || reducedMotion()) {
      el.classList.remove('edge-undrawn')
      el.style.strokeDasharray = data?.state === 'warn' ? '5 5' : ''
      return undefined
    }
    const anim = edgeDrawIn(el, {
      delay: data?.drawDelay ?? 0,
      endDash: data?.state === 'warn' ? '5 5' : '',
    })
    return () => anim?.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <path
      ref={pathRef}
      className="edge-path edge-undrawn"
      data-edge-path=""
      data-edge-id={id}
      d={pathD}
      markerEnd={markerEnd}
    />
  )
}

export default memo(AnimatedEdge)
