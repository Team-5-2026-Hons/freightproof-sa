'use client'

import type { DriverRecord as DriverRecordData } from '@/lib/utils/driver-record'
import { SectionHeading } from '@/components/ui/SectionHeading'

interface DriverRecordProps {
  record: DriverRecordData
}

/**
 * The driver's record from their own trips: three grey tiles under a
 * section heading. The "on time means…" footnote is gone; the rule itself
 * is unchanged — arriving by the planned time, no grace (lib/utils/driver-record).
 */
export function DriverRecord({ record }: DriverRecordProps) {
  const onTime = record.onTimeRate === null ? '—' : `${Math.round(record.onTimeRate * 100)}%`

  return (
    <section aria-labelledby="driver-record-heading" className="flex flex-col gap-3">
      <SectionHeading id="driver-record-heading" title="Your record" className="px-1" />
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2.5">
        <Figure value={String(record.completed)} label="Trips done" />
        <Figure value={onTime} label="On time" />
        <Figure value={String(record.underReview)} label="Under review" />
      </dl>
    </section>
  )
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse rounded-xl bg-fill p-3.5">
      <dt className="text-footnote text-surface-on-variant">{label}</dt>
      <dd className="text-title-1 tabular-nums text-surface-on">{value}</dd>
    </div>
  )
}
