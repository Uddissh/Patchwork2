import { useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { animate } from 'animejs'
import { money } from '../../lib/normalize.js'
import { stageTag } from '../../lib/ui.js'
import { DUR, EASE, reducedMotion, tweenMoney } from '../../lib/motion.js'

/**
 * Supplier node — a paper spec label pinned to the dark operations board.
 * The left spine carries state (forest = selected, faint = alternative,
 * red = failure, accent = replacement). Anime.js animates only this inner
 * card, never the React Flow wrapper. The price readout is tweened on a
 * ref so quotes tick up as cards land and after a reroute.
 */
export default function SupplierNode({ data }) {
  const s = data.supplier
  const ref = useRef(null)
  const priceRef = useRef(null)
  const prevPrice = useRef(0)
  const prevStatus = useRef(s.status)
  const failing = s.status === 'failing' || s.status === 'leaving'

  // Quote tick-up: counts from zero, timed to the card's appearance during
  // the assembly sequence (and immediately for replacements).
  useEffect(() => {
    tweenMoney(priceRef.current, prevPrice.current, s.price, {
      duration: 620,
      delay: data.appearDelay ?? 0,
    })
    prevPrice.current = s.price
  }, [s.price, data.appearDelay])

  // Replacement slot-in — runs once per mount (fresh node id = fresh mount).
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (s.status !== 'repaired' || el.closest('.assembly-pending') || reducedMotion()) {
      el.classList.remove('pre-mount')
      return undefined
    }
    const anim = animate(el, {
      opacity: [0, 1],
      y: [12, 0],
      duration: 520,
      ease: EASE.out,
    })
    el.classList.remove('pre-mount')
    return () => anim?.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Status transitions: precise entrance for the strips, a 300ms shake on
  // failure, and a ~2s soft accent glow when the replacement lands.
  useEffect(() => {
    if (prevStatus.current === s.status) return
    prevStatus.current = s.status
    const el = ref.current
    if (!el || reducedMotion()) return
    if (s.status === 'failing') {
      animate(el, { x: [0, -4, 4, -3, 3, 0], duration: 300, ease: 'outQuad' })
      const strip = el.querySelector('.card-status')
      if (strip) animate(strip, { opacity: [0, 1], y: [-4, 0], duration: DUR.fast, ease: EASE.out })
    } else if (s.status === 'repaired') {
      animate(el, {
        boxShadow: [
          '0 0 0 2px rgba(229, 86, 10, 0.5)',
          '0 0 0 14px rgba(229, 86, 10, 0)',
          '0 0 0 2px rgba(229, 86, 10, 0.4)',
          '0 0 0 18px rgba(229, 86, 10, 0)',
        ],
        duration: 2000,
        ease: 'outQuad',
      })
      const strip = el.querySelector('.card-status')
      if (strip) animate(strip, { opacity: [0, 1], y: [4, 0], duration: DUR.fast, ease: EASE.out })
    }
  }, [s.status])

  // Short-lived REPAIRED badge.
  const [badgeVisible, setBadgeVisible] = useState(s.status === 'repaired')
  useEffect(() => {
    if (s.status !== 'repaired') return undefined
    setBadgeVisible(true)
    const t = setTimeout(() => setBadgeVisible(false), 4200)
    return () => clearTimeout(t)
  }, [s.status])

  const statusNote =
    s.status === 'repaired'
      ? '✓ Replaced'
      : s.status === 'leaving'
        ? 'Disconnecting'
        : '⚠ Supplier unavailable'

  return (
    <div
      ref={ref}
      data-node-card=""
      data-tier={s.stageIndex ?? 0}
      data-slot={s.slot ?? 0}
      data-node-key={s.key}
      role="group"
      aria-label={`${s.name}${data.selected ? ', selected' : ''}, ${data.stageName ?? s.category}, cost ${
        Number.isFinite(s.price) ? money(s.price) : '—'
      }${s.days != null ? `, lead ${s.days} days` : ''}${
        s.status === 'repaired' ? ', replacement active' : failing ? ', failure detected' : ''
      }`}
      className={`supplier-card ${s.status}${data.selected ? '' : ' alt'}${s.status === 'repaired' ? ' pre-mount' : ''}`}
      onMouseEnter={() => data.onHover?.(s.key)}
      onMouseLeave={() => data.onHover?.(null)}
    >
      <span aria-hidden className="spine" />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center justify-between gap-2">
        <span className="stage-tag">{stageTag(s.category, s.stageIndex)}</span>
        <span className="flex items-center gap-1.5">
          {data.selected && <span className="select-tag">Selected</span>}
          <span
            className={`led ${
              failing
                ? 'led-oxide led-pulse'
                : s.status === 'repaired'
                  ? 'led-accent'
                  : data.selected
                    ? 'led-forest'
                    : 'led-hollow'
            }`}
          />
        </span>
      </div>

      <p className="mt-2 truncate text-[15px] font-semibold tracking-[-0.005em] text-ink" title={s.name}>
        {s.name}
      </p>

      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line-soft pt-2">
        <span ref={priceRef} className="metric text-[14px] text-ink" />
        <span className="metric text-[11px] text-secondary">{s.days != null ? `${s.days}d` : '—'}</span>
      </div>

      {data.selected && data.why && (
        <p className="mt-1.5 text-[11px] italic leading-snug text-forest">{data.why}</p>
      )}

      {(failing || (s.status === 'repaired' && badgeVisible)) && (
        <div className={`card-status ${s.status === 'repaired' ? 'ok' : 'crit'}`}>
          <span aria-hidden className="tick" />
          {statusNote}
        </div>
      )}
    </div>
  )
}
