export interface TooltipLine {
  /** Leads the row, bold: the reader already knows the series and wants the number. */
  value: string
  label: string
  /** A short stroke keys the row to its series. Omit for a total row. */
  color?: string
}

interface ChartTooltipProps {
  title: string
  lines: readonly TooltipLine[]
  note?: string
}

/** The hover card every fleet chart uses (dataviz interaction rules): value first and bold,
 *  series name second, a line key rather than a filled box. Everything it shows is also in the
 *  chart's table view, so the tooltip adds detail but never hides any. */
export function ChartTooltip({ title, lines, note }: ChartTooltipProps) {
  return (
    <div className="min-w-[140px] rounded-md bg-surf-lowest px-3 py-2 text-[12px] shadow-level-4">
      <div className="mb-1 text-[11px] font-[600] text-on-surf-v">{title}</div>
      {lines.map((line) => (
        <div key={line.label} className="flex items-center gap-2">
          {line.color !== undefined
            ? <span aria-hidden="true" className="h-[2px] w-3 shrink-0 rounded-full" style={{ backgroundColor: line.color }} />
            : <span aria-hidden="true" className="w-3 shrink-0" />}
          <span className="font-[700] tabular-nums text-on-surf">{line.value}</span>
          <span className="text-on-surf-v">{line.label}</span>
        </div>
      ))}
      {note !== undefined && <div className="mt-1 max-w-[220px] text-on-surf-v">{note}</div>}
    </div>
  )
}
