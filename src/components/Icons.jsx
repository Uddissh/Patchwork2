// Minimal inline SVG icon set (stroke-based, lucide-style).
const PATHS = {
  bolt: { fill: true, paths: ['M13 2 3 14h7l-1 8 10-12h-7l1-8z'] },
  clock: { circles: [[12, 12, 9]], paths: ['M12 7v5l3 3'] },
  check: { paths: ['M4.5 12.5l5 5 10-11'] },
  x: { paths: ['M6 6l12 12', 'M18 6L6 18'] },
  alert: { paths: ['M12 3 2.5 20h19L12 3z', 'M12 10v4', 'M12 17v.01'] },
  spinner: { paths: ['M12 3a9 9 0 1 0 9 9'] },
  arrow: { paths: ['M4 12h14', 'M13 6l6 6-6 6'] },
  dollar: { paths: ['M12 2.5v19', 'M16.5 7c-.8-1.6-2.4-2.4-4.5-2.4-2.5 0-4.3 1.3-4.3 3.2 0 4.3 9.1 2.1 9.1 6.5 0 1.9-1.8 3.2-4.8 3.2-2.4 0-4.2-.9-5-2.6'] },
  network: { circles: [[5, 19, 2], [12, 5, 2], [19, 19, 2]], paths: ['M6.3 17.7 10.7 7', 'M13.3 7l4.4 10.7', 'M7 19h10'] },
  refresh: { paths: ['M20 12a8 8 0 1 1-3-6.2', 'M20 4v5h-5'] },
  lock: { paths: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5.5 11h13v9h-13z'] },
  sparkle: {
    paths: [
      'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z',
      'M18.4 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z',
    ],
  },
}

export function Icon({ name, className = 'h-4 w-4' }) {
  const p = PATHS[name]
  if (!p) return null
  const filled = Boolean(p.fill)
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {(p.paths ?? []).map((d, i) => (
        <path key={i} d={d} />
      ))}
      {(p.circles ?? []).map((c, i) => (
        <circle key={`c${i}`} cx={c[0]} cy={c[1]} r={c[2]} />
      ))}
    </svg>
  )
}
