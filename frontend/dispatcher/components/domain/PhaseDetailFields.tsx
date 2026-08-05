'use client'

import { useState } from 'react'

// ── Shared field primitives ───────────────────────────────────────────────────
// These establish the pattern for future per-phase detail components.

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="text-[13px] font-[800] tracking-[0.09em] uppercase text-on-surf mb-[6px]">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[5px]">
        {children}
      </div>
    </div>
  )
}

export function Field({
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

export function CopyField({ label, value, mono = false, span = false }: {
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

/**
 * The outer shell every per-phase detail card shares: a hairline rule separating it from
 * the card header, and dividers between its sections.
 */
export function PhaseDetailCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 pt-3 border-t border-outline-v/20 divide-y divide-outline-v/15">
      {children}
    </div>
  )
}

/**
 * A GPS fix with its distance from the expected geofence.
 *
 * `offsetMetres` is signed: negative means inside the fence by that many metres, positive
 * means outside by that many. Null means the offset could not be computed (no fix, or no
 * precinct coordinates) — which is different from an offset of zero and must not render
 * as "on the boundary".
 */
export function CoordFix({
  label, lat, lng, offsetMetres,
}: {
  label: string
  lat: number | null
  lng: number | null
  offsetMetres: number | null
}) {
  if (lat === null || lng === null) {
    return <Field label={label} value="No fix recorded" />
  }

  const isOutside = offsetMetres !== null && offsetMetres > 0

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className="font-mono text-[12px] tracking-[0.04em] text-on-surf tabular-nums">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
      {offsetMetres !== null && (
        <div className={`text-[10px] tabular-nums ${isOutside ? 'text-warn' : 'text-ok'}`}>
          {isOutside
            ? `${Math.round(offsetMetres)} m outside geofence`
            : `${Math.round(Math.abs(offsetMetres))} m inside geofence`}
        </div>
      )}
    </div>
  )
}
