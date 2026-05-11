'use client'

import { notFound } from 'next/navigation'
import { TOKENS, type TokenKey } from '@shared/lib/tokens'
import { Z } from '@shared/lib/z-index'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'

const COLOR_GROUPS: { label: string; keys: TokenKey[] }[] = [
  { label: 'Primary — Tarmac Black', keys: ['primary', 'primaryContainer', 'onPrimary', 'onPrimaryContainer'] },
  { label: 'Secondary — Trust Blue', keys: ['secondary', 'secondaryContainer', 'onSecondary', 'onSecondaryContainer', 'secondaryFixed', 'secondaryFixedDim'] },
  { label: 'Tertiary — Amber Warning', keys: ['tertiary', 'tertiaryContainer', 'onTertiary', 'onTertiaryContainer', 'tertiaryFixedDim'] },
  { label: 'Success — Verified Green', keys: ['success', 'successContainer', 'onSuccess', 'onSuccessContainer'] },
  { label: 'Error — Alert Red', keys: ['error', 'errorContainer', 'onError', 'onErrorContainer'] },
  { label: 'Surface Hierarchy', keys: ['surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'surfaceDim', 'onSurface', 'onSurfaceVariant'] },
  { label: 'Outline', keys: ['outline', 'outlineVariant'] },
]

interface TypeRole {
  role: string
  size: string
  weight: number
  spacing: string
  sample: string
}

const TYPE_SCALE: TypeRole[] = [
  { role: 'headline-sm', size: '24px', weight: 700, spacing: '0',       sample: 'Headline Small — Card Titles' },
  { role: 'title-md',    size: '16px', weight: 700, spacing: '0.01em',  sample: 'Title Medium — Step Labels' },
  { role: 'title-sm',    size: '14px', weight: 700, spacing: '0.01em',  sample: 'Title Small — Chip Labels, Badges' },
  { role: 'body-lg',     size: '16px', weight: 400, spacing: '0.03em',  sample: 'Body Large — Primary body text. Driver app flows.' },
  { role: 'body-md',     size: '14px', weight: 400, spacing: '0.015em', sample: 'Body Medium — Descriptions, metadata.' },
  { role: 'label-lg',    size: '14px', weight: 600, spacing: '0.006em', sample: 'Label Large — Timestamps, metadata' },
  { role: 'mono-id',     size: '13px', weight: 700, spacing: '0.05em',  sample: 'TRP-2026-0041  ·  SEAL-7789-A' },
]

const SHADOWS = [
  { name: 'shadow-ambient-sm',    value: '0 4px 20px rgba(27, 27, 28, 0.06)', usage: 'Compact cards' },
  { name: 'shadow-ambient',       value: '0 8px 40px rgba(27, 27, 28, 0.06)', usage: 'Standard cards' },
  { name: 'shadow-ambient-up-lg', value: '0 -8px 40px rgba(0, 0, 0, 0.08)',   usage: 'Bottom nav bar' },
]

const RADII = [
  { name: 'rounded-xl',   value: '8px',  usage: 'Cards, buttons, inputs' },
  { name: 'rounded-full', value: '12px', usage: 'Status pills, avatars' },
]

export default function TokensPage() {
  const { simulateGateArrival } = usePushNotifications()

  if (process.env.NODE_ENV !== 'development') notFound()

  const zEntries = Object.entries(Z) as [keyof typeof Z, number][]

  return (
    <main className="min-h-dvh bg-surface p-4 font-sans pb-16">

      <header className="mb-8 pb-4 border-b border-outline-variant/30">
        <p className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">DEV ONLY — DRIVER PWA</p>
        <h1 className="text-2xl font-bold text-surface-on">Design System — Token Preview</h1>
        <p className="mt-1 text-sm text-surface-on-variant">
          Visual sign-off gate. Verify tokens match{' '}
          <span className="font-mono text-xs tracking-[0.05em]">DESIGN_SYSTEM.md §2</span>.
        </p>
      </header>

      {/* ── PUSH NOTIFICATION SIMULATION ────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-1">Push Notification Simulation</h2>
        <p className="text-xs text-surface-on-variant mb-4 leading-relaxed">
          Simulates a GATE_ARRIVAL push. Navigates to handshake step for TRP-2026-0041.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => simulateGateArrival(1)}
            className="w-full min-h-[52px] rounded-xl bg-primary text-primary-on font-bold text-sm uppercase tracking-wider shadow-ambient active:scale-[0.98] transition-all duration-200"
          >
            Simulate Gate Arrival — Handshake 1
          </button>
          <button
            onClick={() => simulateGateArrival(4)}
            className="w-full min-h-[52px] rounded-xl bg-secondary text-secondary-on font-bold text-sm uppercase tracking-wider shadow-ambient active:scale-[0.98] transition-all duration-200"
          >
            Simulate Gate Arrival — Handshake 4
          </button>
        </div>
      </section>

      {/* ── COLOURS ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-4">Colours</h2>
        <div className="flex flex-col gap-6">
          {COLOR_GROUPS.map(group => (
            <div key={group.label}>
              <h3 className="text-xs font-bold text-surface-on-variant mb-3 uppercase tracking-wider">
                {group.label}
              </h3>
              <div className="flex flex-wrap gap-3">
                {group.keys.map(key => (
                  <div key={key} className="flex flex-col gap-1">
                    <div
                      className="w-14 h-14 rounded-xl shadow-ambient-sm border border-outline-variant/20"
                      style={{ backgroundColor: TOKENS[key] }}
                      title={TOKENS[key]}
                    />
                    <p className="text-[10px] font-medium text-surface-on max-w-[56px] break-words leading-tight">{key}</p>
                    <p className="font-mono text-[10px] text-surface-on-variant">{TOKENS[key]}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TYPOGRAPHY ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-4">Typography — Inter</h2>
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden">
          {TYPE_SCALE.map((t, i) => (
            <div
              key={t.role}
              className={`flex items-start gap-3 border-b border-outline-variant/10 p-3 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/40'}`}
            >
              <div className="min-w-[90px] flex-shrink-0">
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{t.role}</p>
                <p className="text-[10px] text-surface-on-variant mt-0.5">{t.size} / w{t.weight}</p>
              </div>
              <span
                style={{
                  fontSize: t.size,
                  fontWeight: t.weight,
                  letterSpacing: t.spacing,
                  fontFamily: 'var(--font-inter)',
                }}
                className="text-surface-on overflow-hidden"
              >
                {t.sample}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── SHADOWS ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-1">Ambient Shadows</h2>
        <p className="text-xs text-surface-on-variant mb-4">Soft, large-radius. No hard offset shadows.</p>
        <div className="flex flex-col gap-5">
          {SHADOWS.map(s => (
            <div key={s.name} className="flex items-center gap-4">
              <div
                className="w-20 h-12 flex-shrink-0 bg-surface-container-lowest rounded-xl"
                style={{ boxShadow: s.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{s.name}</p>
                <p className="text-[11px] text-surface-on-variant mt-1">{s.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BORDER RADII ────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-4">Border Radii</h2>
        <div className="flex flex-col gap-4">
          {RADII.map(r => (
            <div key={r.name} className="flex items-center gap-4">
              <div
                className="w-20 h-12 flex-shrink-0 bg-primary shadow-ambient-sm"
                style={{ borderRadius: r.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{r.name}</p>
                <p className="text-[11px] text-surface-on-variant mt-0.5">{r.value} — {r.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Z-INDEX ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-surface-on mb-4">Z-Index Scale</h2>
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden">
          {zEntries.map(([level, value], i) => (
            <div
              key={level}
              className={`flex items-center gap-3 border-b border-outline-variant/10 px-3 py-2 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/40'}`}
            >
              <p className="font-mono text-xs font-medium text-secondary w-20 flex-shrink-0 tracking-[0.04em]">Z.{level}</p>
              <p className="font-mono text-xs text-surface-on w-8 flex-shrink-0">{value}</p>
              <p className="text-xs text-surface-on-variant">
                {level === 'base'    && 'Default document flow'}
                {level === 'raised'  && 'Dropdowns, hover states'}
                {level === 'sticky'  && 'Sticky headers, sidebar'}
                {level === 'overlay' && 'Drawers, slide-overs'}
                {level === 'modal'   && 'Modals, dialogs'}
                {level === 'toast'   && 'Toast notifications'}
                {level === 'panic'   && 'Panic button — always on top'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-outline-variant/30 pt-3">
        <p className="text-xs text-surface-on-variant">
          FreightProof SA — Token Preview · Driver PWA · DEV ONLY
        </p>
      </footer>

    </main>
  )
}
