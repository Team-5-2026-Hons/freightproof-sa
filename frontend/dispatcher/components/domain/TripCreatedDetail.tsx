'use client'

import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { CopyField, Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import type { ConsignmentRead, Trip } from '@shared/lib/types/trip'

// Declared value and PP manifest number are independently nullable, so the separator is
// joined between the parts that exist rather than appended to the first — otherwise a
// consignment with a value but no manifest number renders a dangling "· ".
function consignmentMeta(c: ConsignmentRead): string {
  return [
    // declared_value is a backend Decimal (monetary — needs exact base-10 arithmetic),
    // so it arrives over the wire as a JSON string. String.toLocaleString() exists but
    // ignores its arguments and returns the string unchanged, silently dropping
    // thousands separators — Number() coercion is safe whether it arrives as a string
    // or a number.
    c.declared_value !== null ? `Declared R${Number(c.declared_value).toLocaleString('en-ZA')}` : null,
    c.pp_manifest_number !== null ? `PP manifest ${c.pp_manifest_number}` : null,
  ].filter((part): part is string => part !== null).join(' · ')
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  trip: Trip
}

export function TripCreatedDetail({ trip }: Props) {
  const { driver, horse } = trip
  const receipt = trip.blockchain_receipts[0] ?? null
  const isPending = !receipt?.hedera_topic_id || receipt.hedera_topic_id === 'None'

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Nullable per consignment (unit/parcel counts are dispatcher-entered and PP-derived
  // respectively) — a missing value must contribute zero, not poison the sum to NaN.
  const totalUnits   = trip.consignments.reduce((n, c) => n + (c.unit_count_expected ?? 0), 0)
  const totalParcels = trip.consignments.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)

  return (
    <PhaseDetailCard>

      {/* Driver ─────────────────────────────────────────────────────────── */}
      {driver && (
        <Section title="Driver">
          <Field label="Full name"      value={driver.full_name} />
          <Field label="Phone"          value={driver.phone_number} />
          <Field label="License number" value={driver.license_number} mono />
          <Field label="ID number"      value={driver.id_number} mono />
        </Section>
      )}

      {/* Vehicle ─────────────────────────────────────────────────────────── */}
      {horse && (
        <Section title="Horse (Vehicle)">
          <Field label="Registration" value={horse.registration} mono />
          <Field label="Make"         value={horse.make} />
          <Field label="Model"        value={horse.model} />
          <Field label="Year"         value={horse.year?.toString()} />
        </Section>
      )}

      {/* Trailers ────────────────────────────────────────────────────────── */}
      {trip.trailers.length > 0 && (
        <Section title={`Trailer${trip.trailers.length > 1 ? 's' : ''}`}>
          {trip.trailers.map(trailer => (
            <Field key={trailer.id} label={trailer.vehicle_type} value={trailer.registration} mono />
          ))}
        </Section>
      )}

      {/* Trip type ───────────────────────────────────────────────────────── */}
      <Section title="Trip">
        <Field label="Type" value={trip.trip_type === 'loaded' ? 'Loaded' : 'Empty leg'} />
      </Section>

      {/* Tracking ───────────────────────────────────────────────────────── */}
      {trip.pulsit_trip_reference_id && (
        <Section title="Tracking">
          <CopyField label="Pulsit tracking reference" value={trip.pulsit_trip_reference_id} mono span />
        </Section>
      )}

      {/* Consignments — what was committed to this truck at creation. This belongs on the
          creation event rather than in the sidebar because it describes the state that was
          hashed into the journey lock, not current state. */}
      {trip.consignments.length > 0 && (
        <div className="py-3">
          <div className="text-[13px] font-[800] tracking-[0.09em] uppercase text-on-surf mb-[6px]">
            Consignments ({trip.consignments.length})
          </div>
          <div className="divide-y divide-outline-v/15">
            {trip.consignments.map(c => (
              <div key={c.id} className="py-[7px] first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12px] font-[600] tracking-[0.04em] text-on-surf">
                    {c.parcel_perfect_reference}
                  </span>
                  <span className="text-[11px] text-on-surf-v tabular-nums shrink-0">
                    {c.unit_count_expected ?? '—'} units · {c.parcel_count_expected ?? '—'} parcels
                  </span>
                </div>
                {consignmentMeta(c) && (
                  <div className="text-[10px] text-on-surf-v mt-[2px] tabular-nums">
                    {consignmentMeta(c)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-3 pt-[8px] mt-[4px] border-t border-outline-v/20">
            <span className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v">Total</span>
            <span className="text-[11px] font-[600] text-on-surf tabular-nums">
              {totalUnits} units · {totalParcels} parcels
            </span>
          </div>
        </div>
      )}

      {/* Blockchain — forensic detail; hidden for non-admin / forensic-off dispatchers. */}
      {receipt && (
        <ForensicOnly>
          <Section title="Blockchain">
            <CopyField label="SHA-256 journey lock hash" value={receipt.data_hash} mono span />
            <Field     label="Hedera topic ID"  value={isPending ? 'Pending' : receipt.hedera_topic_id} mono />
            <Field     label="Sequence"         value={isPending ? '—' : `#${receipt.hedera_sequence_number}`} mono />
            <Field     label="Anchored at"      value={fmtDate(receipt.hedera_consensus_timestamp)} />
            <CopyField label="Hedera TX ID"     value={receipt.hedera_tx_id} mono span />
          </Section>
        </ForensicOnly>
      )}

    </PhaseDetailCard>
  )
}
