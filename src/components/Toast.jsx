import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { DUR, EASE, reducedMotion } from '../lib/motion.js'
import { Icon } from './Icons.jsx'

export default function Toast({ toast, onClose }) {
  const ref = useRef(null)

  const impactChip = {
    'no impact': 'border-moss/40 bg-moss/10 text-moss',
    'minor delay': 'border-amber-600/40 bg-amber-500/10 text-amber-700',
    'cost increase': 'border-brick/40 bg-brick/10 text-brick',
  }[toast?.detail?.impact]

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [toast?.id, onClose])

  useEffect(() => {
    if (!toast || reducedMotion() || !ref.current) return
    const anim = animate(ref.current, {
      opacity: [0, 1],
      y: [10, 0],
      duration: DUR.fast,
      ease: EASE.out,
    })
    return () => anim?.cancel()
  }, [toast?.id])

  if (!toast) return null

  const isError = toast.type === 'error'
  const accent = isError
    ? 'text-brick'
    : toast.type === 'success'
      ? 'text-moss'
      : 'text-forest'

  return (
    <div ref={ref} className="fixed bottom-5 left-5 z-50 max-w-sm">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        className={`toast ${accent} flex items-start gap-3 px-4 py-3.5`}
      >
        <Icon
          name={isError ? 'alert' : toast.type === 'success' ? 'check' : 'bolt'}
          className="mt-0.5 h-4 w-4 flex-none"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-ink">{toast.message}</p>
          {toast.detail?.explanation && (
            <p className="mt-1 text-[12px] italic leading-snug text-secondary">
              {toast.detail.explanation}
            </p>
          )}
          {impactChip && (
            <span className={`mt-1.5 inline-flex rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium ${impactChip}`}>
              {toast.detail.impact}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="ml-2 text-faint transition hover:text-secondary"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
