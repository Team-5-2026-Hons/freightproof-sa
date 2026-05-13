interface StatCardProps {
  value: string
  label: string
  /** Red value colour — for exception counts etc. */
  warn?: boolean
  /** Green value colour — for on-time rates etc. */
  success?: boolean
}

export function StatCard({ value, label, warn, success }: StatCardProps) {
  return (
    <div className="bg-surf-lowest rounded-lg p-[16px_20px] flex-1 shadow-level-3">
      <div
        className={[
          'text-[28px] font-[800] tracking-[-0.03em] leading-none',
          warn    ? 'text-err' :
          success ? 'text-ok'  :
                    'text-on-surf',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="text-[12px] font-[500] text-on-surf-v mt-[6px]">
        {label}
      </div>
    </div>
  )
}
