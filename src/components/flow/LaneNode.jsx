/**
 * Stage lane — a structural band behind each supply tier on the canvas.
 * Non-interactive (pointer-events: none); gives the graph its columns.
 */
export default function LaneNode({ data }) {
  return (
    <div
      aria-hidden
      data-lane=""
      className="lane"
      style={{ width: 292, height: data.height }}
    >
      <div className="lane-head">
        <span className="lane-idx">{String(data.index + 1).padStart(2, '0')}</span>
        <span>{String(data.name ?? 'Stage').toUpperCase()}</span>
      </div>
      <div className="lane-rule" />
      <div className="lane-count">
        {data.count} {data.count === 1 ? 'supplier' : 'suppliers'}
      </div>
    </div>
  )
}
