'use client'

import { useState } from 'react'
import type { Trip } from '@shared/lib/types/trip'

// ── Shared field primitives ───────────────────────────────────────────────────
// These establish the pattern for future handshake detail components.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[6px]">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[5px]">
        {children}
      </div>
    </div>
  )
}

function Field({
  label, value, mono = false, span = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  span?: boolean
}) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className={`text-[12px] font-[500] text-on-surf leading-snug${mono ? ' font-mono tracking-[0.04em]' : ''}`}>
        {value || '—'}
      </div>
    </div>
  )
}

function CopyField({ label, value, mono = false, span = false }: {
  label: string
  value: string | null | undefined
  mono?: boolean
  span?: boolean
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!value) return
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className="flex items-start gap-[6px]">
        <span className={`text-[12px] font-[500] text-on-surf break-all leading-snug flex-1${mono ? ' font-mono tracking-[0.04em]' : ''}`}>
          {value || '—'}
        </span>
        {value && (
          <button
            onClick={copy}
            className="shrink-0 mt-[1px] inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  )
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

  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20 divide-y divide-outline-v/15">

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

      {/* Tracking ───────────────────────────────────────────────────────── */}
      {trip.pulsit_trip_reference_id && (
        <Section title="Tracking">
          <CopyField label="Pulsit tracking reference" value={trip.pulsit_trip_reference_id} mono span />
        </Section>
      )}

      {/* Blockchain ─────────────────────────────────────────────────────── */}
      {receipt && (
        <Section title="Blockchain">
          <CopyField label="SHA-256 journey lock hash" value={receipt.data_hash} mono span />
          <Field     label="Hedera topic ID"  value={isPending ? 'Pending' : receipt.hedera_topic_id} mono />
          <Field     label="Sequence"         value={isPending ? '—' : `#${receipt.hedera_sequence_number}`} mono />
          <Field     label="Anchored at"      value={fmtDate(receipt.hedera_consensus_timestamp)} />
          <CopyField label="Hedera TX ID"     value={receipt.hedera_tx_id} mono span />
        </Section>
      )}

    </div>
  )
}
