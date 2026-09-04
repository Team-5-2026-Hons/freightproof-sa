interface InfoRowProps {
  label: string
  value: string
  mono?: boolean
  // Renders the value as a link (`tel:` for a driver's number). Optional and additive:
  // every existing call site keeps rendering plain text unchanged.
  href?: string
}

export function InfoRow({ label, value, mono = false, href }: InfoRowProps) {
  const valueClass = `text-right font-[500] text-on-surf${mono ? ' tabular-nums tracking-[0.05em] font-[600]' : ''}`
  return (
    <div className="flex justify-between items-start gap-3 py-[8px] border-b border-outline-v/20 last:border-0 text-[13px]">
      <span className="text-[11px] text-on-surf-v shrink-0 pt-[1px]">{label}</span>
      {href ? (
        <a href={href} className={`${valueClass} text-pri underline underline-offset-2 hover:no-underline`}>
          {value}
        </a>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
    </div>
  )
}
