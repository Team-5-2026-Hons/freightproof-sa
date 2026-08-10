interface InfoRowProps {
  label: string
  value: string
  mono?: boolean
}

export function InfoRow({ label, value, mono = false }: InfoRowProps) {
  return (
    <div className="flex justify-between items-start gap-3 py-[8px] border-b border-outline-v/20 last:border-0 text-[13px]">
      <span className="text-[11px] text-on-surf-v shrink-0 pt-[1px]">{label}</span>
      <span className={`text-right font-[500] text-on-surf${mono ? ' tabular-nums tracking-[0.05em] font-[600]' : ''}`}>
        {value}
      </span>
    </div>
  )
}
