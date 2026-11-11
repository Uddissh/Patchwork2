/**
 * Deadline fit — real arithmetic only: estimated end-to-end lead (selected
 * suppliers) vs the requested deadline. Hidden entirely when either value
 * is unknown, so nothing is ever fabricated. `still` frames the on-time
 * verdict as "Still on time" after a disruption.
 */
export default function DeadlineBadge({ lead, deadline, still = false }) {
  if (!Number.isFinite(lead) || !Number.isFinite(deadline) || deadline <= 0) return null
  const over = lead - deadline
  if (over <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-moss/40 bg-moss/10 px-2.5 py-1 font-mono text-[11px] font-medium text-moss">
        <span aria-hidden className="led led-moss" />
        {still ? 'Still on time' : 'On time'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brick/40 bg-brick/10 px-2.5 py-1 font-mono text-[11px] font-medium text-brick">
      <span aria-hidden className="led led-oxide" />
      {over} {over === 1 ? 'day' : 'days'} over
    </span>
  )
}
