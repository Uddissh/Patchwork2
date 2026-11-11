import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { API_BASE } from '../api.js'
import { EASE, reducedMotion } from '../lib/motion.js'

const STEPS = [
  { n: 1, label: 'Request', view: 'request' },
  { n: 2, label: 'Network', view: 'network' },
  { n: 3, label: 'Checkout', view: 'checkout' },
]

export default function Header({ step, canGoTo, onGo }) {
  const navRef = useRef(null)
  const tabRefs = useRef({})
  const underlineRef = useRef(null)
  const prevStep = useRef(step)

  // The accent bar slides to the active tab (tweened left + width) instead
  // of jumping; inactive tabs breathe once whenever the view changes.
  useEffect(() => {
    const changed = prevStep.current !== step
    prevStep.current = step

    const move = (animated) => {
      const nav = navRef.current
      const bar = underlineRef.current
      if (!nav || !bar) return
      const navBox = nav.getBoundingClientRect()
      const active = tabRefs.current[step]
      const box = (active ?? nav).getBoundingClientRect()
      const x = box.left - navBox.left
      const w = box.width
      if (reducedMotion() || !animated) {
        bar.style.transform = `translateX(${x}px)`
        bar.style.width = `${w}px`
        return
      }
      animate(bar, { x, width: w, duration: 420, ease: EASE.inOut })
    }
    move(true)

    if (changed && !reducedMotion()) {
      for (const s of STEPS) {
        if (s.n === step) continue
        const el = tabRefs.current[s.n]
        if (el) animate(el, { opacity: [1, 0.45, 1], duration: 560, ease: 'inOutQuad' })
      }
    }

    const onResize = () => move(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [step])

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-limestone">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4 lg:px-10">
        <button type="button" onClick={() => onGo?.('request')} className="flex items-center gap-3 text-left">
          <span aria-hidden className="grid grid-cols-2 gap-[2px]">
            <span className="h-[7px] w-[7px] bg-ink" />
            <span className="h-[7px] w-[7px] bg-forest" />
            <span className="h-[7px] w-[7px] bg-oxide" />
            <span className="h-[7px] w-[7px] border border-line bg-transparent" />
          </span>
          <span className="leading-none">
            <span className="block font-mono text-[13px] font-semibold tracking-[0.2em] text-ink">
              PATCH<span className="text-forest">WORK</span>
            </span>
            <span className="mt-1 hidden font-sans text-[11px] italic text-secondary lg:block">
              supplier networks, assembled
            </span>
          </span>
        </button>

        <nav className="relative hidden items-center gap-7 pb-2 sm:flex" aria-label="Progress">
          {STEPS.map((s) => {
            const done = step > s.n
            const current = step === s.n
            const enabled = canGoTo?.(s.n)
            return (
              <button
                key={s.n}
                type="button"
                ref={(el) => {
                  tabRefs.current[s.n] = el
                }}
                disabled={!enabled}
                aria-current={current ? 'step' : undefined}
                onClick={() => enabled && onGo(s.view)}
                className={`flex items-baseline gap-2 transition ${
                  current ? 'text-oxide' : done ? 'text-secondary hover:text-ink' : 'text-faint'
                } ${enabled && !current ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className="font-mono text-[10px] font-medium tracking-[0.08em]">
                  {String(s.n).padStart(2, '0')}
                </span>
                <span className="text-[13px] font-medium tracking-[0.01em]">{s.label}</span>
              </button>
            )
          })}
          {/* thin progress track — the accent underline slides to the active tab */}
          <span aria-hidden className="absolute bottom-0 left-0 right-0 h-[2px] bg-line" />
          <span
            aria-hidden
            ref={underlineRef}
            className="absolute bottom-0 left-0 h-[2px] bg-oxide will-change-transform"
            style={{ width: 0 }}
          />
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <span className="metric text-[10px] text-faint">{API_BASE.replace(/^https?:\/\//, '')}</span>
        </div>
      </div>
    </header>
  )
}
