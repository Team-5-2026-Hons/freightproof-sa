'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import type { Trip } from '@shared/lib/types/trip'

// ── Shared field primitives ───────────────────────────────────────────────────
// These establish the pattern for future handshake detail components.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[8px]">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[6px]">
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
      <div className="text-[10px] text-on-surf-v mb-[2px]">{label}</div>
      <div className={`text-[12px] font-[500] text-on-surf${mono ? ' font-mono tracking-[0.04em]' : ''}`}>
        {value || '—'}
      </div>
    </div>
  )
}

function IdvsChip({ status }: { status: 'verified' | 'pending' | 'failed' }) {
  const styles = {
    verified: 'bg-ok-c text-on-ok-c',
    pending:  'bg-surf-high text-on-surf-v',
    failed:   'bg-err-c text-on-err-c',
  }
  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[2px]">IDVS</div>
      <span className={`inline-flex items-center gap-[4px] rounded-full px-[8px] py-[2px] text-[10px] font-[700] ${styles[status]}`}>
        {status === 'verified' && <Ic n="check" s={9} />}
        {status === 'failed'   && <Ic n="warn"  s={9} />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </div>
  )
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(hash).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="col-span-2">
      <div className="text-[10px] text-on-surf-v mb-[2px]">SHA-256 journey lock hash</div>
      <div className="flex items-start gap-[6px]">
        <span className="font-mono text-[11px] tracking-[0.03em] text-on-surf break-all leading-relaxed flex-1">
          {hash}
        </span>
        <button
          onClick={copy}
          className="shrink-0 mt-[1px] text-[10px] font-[500] text-on-surf-v hover:text-on-surf transition-colors"
        >
          {copied ? '✓' : 'copy'}
        </button>
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
    <div className="mt-3 pt-3 border-t border-outline-v/20 space-y-4">

      {/* Driver ─────────────────────────────────────────────────────────── */}
      {driver && (
        <Section title="Driver">
          <Field label="Full name"       value={driver.full_name} />
          <Field label="Phone"           value={driver.phone_number} />
          <Field label="License number"  value={driver.license_number} mono />
          <Field label="ID number"       value={driver.id_number}      mono />
          <IdvsChip status={driver.idvs_status} />
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
          <Field label="Pulsit tracking reference" value={trip.pulsit_trip_reference_id} mono span />
        </Section>
      )}

      {/* Blockchain ─────────────────────────────────────────────────────── */}
      {receipt && (
        <Section title="Blockchain">
          <CopyHash hash={receipt.data_hash} />
          <Field label="Hedera topic ID"     value={isPending ? 'Pending' : receipt.hedera_topic_id} mono />
          <Field label="Sequence"            value={isPending ? '—' : `#${receipt.hedera_sequence_number}`} mono />
          <Field label="Anchored at"         value={fmtDate(receipt.hedera_consensus_timestamp)} />
          <Field label="Hedera TX ID"        value={receipt.hedera_tx_id} mono span />
        </Section>
      )}

    </div>
  )
}
