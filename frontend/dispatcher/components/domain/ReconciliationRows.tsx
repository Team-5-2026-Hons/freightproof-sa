interface Props {
  countedAtDestination: number | null | undefined
  driverVisualCount: number | null | undefined
}

/**
 * Destination count against the driver's visual count.
 *
 * A discrepancy between these two is the entire purpose of the unloading handshake, so the
 * verdict is stated explicitly. Both counts are nullable and a null is NOT a zero — with
 * either missing there is no verdict to give, only two rows.
 */
export function ReconciliationRows({ countedAtDestination, driverVisualCount }: Props) {
  const hasBoth =
    countedAtDestination !== null && countedAtDestination !== undefined &&
    driverVisualCount   !== null && driverVisualCount   !== undefined

  return (
    <>
      <div className="flex justify-between text-[11px] py-[2px]">
        <span className="text-on-surf-v">Counted at destination</span>
        <span className="text-on-surf tabular-nums">{countedAtDestination ?? '—'}</span>
      </div>
      <div className="flex justify-between text-[11px] py-[2px]">
        <span className="text-on-surf-v">Driver visual count</span>
        <span className="text-on-surf tabular-nums">{driverVisualCount ?? '—'}</span>
      </div>
      {hasBoth && (
        <div className={`text-[11px] font-[600] mt-[4px] ${
          countedAtDestination === driverVisualCount ? 'text-ok' : 'text-warn'
        }`}>
          {countedAtDestination === driverVisualCount
            ? 'Counts agree ✓'
            : `Discrepancy of ${Math.abs(countedAtDestination - driverVisualCount)} ✗`}
        </div>
      )}
    </>
  )
}
