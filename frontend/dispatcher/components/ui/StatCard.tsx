interface StatCardProps {
  value: string
  label: string
  /** Red value colour — for exception counts etc. */
  warn?: boolean
  /** Green value colour — for on-time rates etc. */
  success?: boolean
  /** Shows pulsing placeholder bars instead of value/label while data is loading. */
  loading?: boolean
}

export function StatCard({ value, label, warn, success, loading }: StatCardProps) {
  return (
    <div className="bg-surf-lowest rounded-lg p-[16px_20px] flex-1 shadow-level-3">
      {loading ? (
        <>
          <div className="h-[28px] w-[60px] rounded-[var(--r-sm)] bg-surf-high animate-pulse" />
          <div className="h-[12px] w-[90px] rounded-[var(--r-sm)] bg-surf-high animate-pulse mt-[6px]" />
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
