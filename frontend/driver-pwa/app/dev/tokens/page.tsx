"use client"

import { notFound } from 'next/navigation'
import { TOKENS, type TokenKey } from '@shared/lib/tokens'
import { Z } from '@shared/lib/z-index'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'

const COLOR_GROUPS: { label: string; keys: TokenKey[] }[] = [
  { label: 'Primary — Tarmac',         keys: ['primary', 'primaryContainer', 'onPrimary', 'onPrimaryContainer'] },
  { label: 'Secondary — Signal Orange', keys: ['secondary', 'secondaryContainer', 'onSecondary', 'onSecondaryContainer'] },
  { label: 'Tertiary — Caution Yellow', keys: ['tertiary', 'tertiaryContainer', 'onTertiary', 'onTertiaryContainer', 'tertiaryFixedDim'] },
  { label: 'Success — Phosphor Green',  keys: ['success', 'successContainer', 'onSuccess', 'onSuccessContainer'] },
  { label: 'Error — Emergency Red',     keys: ['error', 'errorContainer', 'onError', 'onErrorContainer'] },
  { label: 'Surface Hierarchy',         keys: ['surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant'] },
  { label: 'Outline',                   keys: ['outline', 'outlineVariant'] },
]

interface TypeRole {
  role: string
  size: string
  lineHeight: string
  weight: number
  spacing: string
  family: 'sans' | 'mono'
  sample: string
}

const TYPE_SCALE: TypeRole[] = [
  { role: 'display-lg',  size: '57px', lineHeight: '64px', weight: 700, spacing: '-0.02em', family: 'sans', sample: 'Display Large — Key Metrics' },
  { role: 'display-md',  size: '45px', lineHeight: '52px', weight: 700, spacing: '-0.02em', family: 'sans', sample: 'Display Medium' },
  { role: 'display-sm',  size: '36px', lineHeight: '44px', weight: 600, spacing: '-0.02em', family: 'sans', sample: 'Display Small' },
  { role: 'headline-lg', size: '32px', lineHeight: '40px', weight: 600, spacing: '0',       family: 'sans', sample: 'Headline Large — Page Titles' },
  { role: 'headline-md', size: '28px', lineHeight: '36px', weight: 600, spacing: '0',       family: 'sans', sample: 'Headline Medium — Section Headings' },
  { role: 'headline-sm', size: '24px', lineHeight: '32px', weight: 600, spacing: '0',       family: 'sans', sample: 'Headline Small — Sub-section Headings' },
  { role: 'title-lg',    size: '22px', lineHeight: '28px', weight: 600, spacing: '0',       family: 'sans', sample: 'Title Large — Card Titles' },
  { role: 'title-md',    size: '16px', lineHeight: '24px', weight: 600, spacing: '0.01em',  family: 'sans', sample: 'Title Medium — List Headers, Sidebar Labels' },
  { role: 'title-sm',    size: '14px', lineHeight: '20px', weight: 600, spacing: '0.01em',  family: 'sans', sample: 'Title Small — Chip Labels, Status Badges' },
  { role: 'body-lg',     size: '16px', lineHeight: '24px', weight: 400, spacing: '0.03em',  family: 'sans', sample: 'Body Large — Primary body text. Driver app flows and evidence descriptions.' },
  { role: 'body-md',     size: '14px', lineHeight: '20px', weight: 400, spacing: '0.015em', family: 'sans', sample: 'Body Medium — Secondary body text. Descriptions, metadata, notes.' },
  { role: 'body-sm',     size: '12px', lineHeight: '16px', weight: 400, spacing: '0.025em', family: 'sans', sample: 'Body Small — Caption text. Use sparingly.' },
  { role: 'label-lg',    size: '14px', lineHeight: '20px', weight: 500, spacing: '0.006em', family: 'sans', sample: 'Label Large — Metadata labels, timestamps' },
  { role: 'label-md',    size: '12px', lineHeight: '16px', weight: 500, spacing: '0.03em',  family: 'sans', sample: 'Label Medium — Secondary metadata' },
  { role: 'label-sm',    size: '11px', lineHeight: '16px', weight: 500, spacing: '0.03em',  family: 'sans', sample: 'Label Small — Compact tables, trip IDs in lists' },
  { role: 'mono-id',     size: '13px', lineHeight: '20px', weight: 500, spacing: '0.05em',  family: 'mono', sample: 'TRP-2026-0041  ·  SEAL-7789-A  ·  0xE3B0C44298FC1C14' },
  { role: 'mono-hash',   size: '11px', lineHeight: '16px', weight: 400, spacing: '0.04em',  family: 'mono', sample: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
]

const SHADOWS = [
  { name: 'shadow-hard-sm', value: '2px 2px 0px #000000', usage: 'Chips, badges, small interactive elements' },
  { name: 'shadow-hard',    value: '4px 4px 0px #000000', usage: 'Cards, modals, standard floating elements' },
  { name: 'shadow-hard-lg', value: '6px 6px 0px #000000', usage: 'Elevated panels, high-priority overlays' },
  { name: 'shadow-hard-up', value: '0 -4px 0px #000000',  usage: 'Bottom nav, upward-anchored elements' },
]

const RADII = [
  { name: 'radius-none', value: '0px', tailwind: 'rounded-none',  usage: 'Outer cards, panels, layout containers' },
  { name: 'radius-sm',   value: '2px', tailwind: 'rounded-[2px]', usage: 'Inner elements, chips, badges' },
  { name: 'radius-md',   value: '4px', tailwind: 'rounded-[4px]', usage: 'Buttons, input fields, modals, overlays' },
]

export default function TokensPage() {
  const { simulateGateArrival } = usePushNotifications()

  if (process.env.NODE_ENV !== 'development') notFound()

  const zEntries = Object.entries(Z) as [keyof typeof Z, number][]

  return (
    <main className="min-h-screen bg-surface p-4 font-sans pb-16">
      <header className="mb-8 border-b-2 border-outline pb-4">
        <p className="font-mono text-[13px] font-medium tracking-[0.05em] text-secondary mb-1">DEV ONLY — DRIVER PWA</p>
        <h1 className="text-[24px] font-semibold leading-8 text-surface-on">
          Design System — Token Preview
        </h1>
        <p className="mt-1 text-[14px] leading-5 text-surface-on-variant">
          Phase 0 sign-off gate. Verify colours match{' '}
          <span className="font-mono text-[12px]">DESIGN_SYSTEM.md §2.2</span>.
        </p>
      </header>

      {/* ── PUSH NOTIFICATION SIMULATION ────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-3">Push Notification Simulation</h2>
        <p className="text-[12px] text-surface-on-variant mb-4 leading-4">
          Simulates a GATE_ARRIVAL push that would normally come from the backend via FCM.
          Navigates to the first step of the specified handshake for TRP-2026-0041.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => simulateGateArrival(1)}
            className="w-full min-h-[52px] border-2 border-outline bg-primary text-on-primary font-semibold text-[16px] tracking-[0.03em] shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none transition-transform"
          >
            Simulate Gate Arrival — Handshake 1
          </button>
          <button
            onClick={() => simulateGateArrival(4)}
            className="w-full min-h-[52px] border-2 border-outline bg-secondary text-on-secondary font-semibold text-[16px] tracking-[0.03em] shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none transition-transform"
          >
            Simulate Gate Arrival — Handshake 4
          </button>
        </div>
      </section>

      {/* ── COLOURS ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-4">Colours</h2>
        <div className="flex flex-col gap-6">
          {COLOR_GROUPS.map(group => (
            <div key={group.label}>
              <h3 className="text-[11px] font-semibold text-surface-on-variant mb-3 uppercase tracking-[0.08em]">
                {group.label}
              </h3>
              <div className="flex flex-wrap gap-3">
                {group.keys.map(key => (
                  <div key={key} className="flex flex-col gap-1">
                    <div
                      className="w-16 h-16 border-2 border-outline"
                      style={{ backgroundColor: TOKENS[key] }}
                      title={TOKENS[key]}
                    />
                    <p className="text-[10px] font-medium text-surface-on leading-3 max-w-[64px] break-words">{key}</p>
                    <p className="font-mono text-[10px] text-surface-on-variant leading-3">{TOKENS[key]}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TYPOGRAPHY ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-4">Typography Scale</h2>
        <div className="border-2 border-outline overflow-x-auto">
          {TYPE_SCALE.map((t, i) => (
            <div
              key={t.role}
              className={`flex items-start gap-3 border-b border-outline p-3 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface'}`}
            >
              <div className="min-w-[100px] flex-shrink-0">
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{t.role}</p>
                <p className="text-[10px] text-surface-on-variant mt-0.5 leading-3">
                  {t.size} / w{t.weight}
                </p>
              </div>
              <span
                style={{
                  fontSize: t.size,
                  lineHeight: t.lineHeight,
                  fontWeight: t.weight,
                  letterSpacing: t.spacing,
                  fontFamily: t.family === 'mono' ? 'var(--font-ibm-plex-mono)' : 'var(--font-space-grotesk)',
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
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-4">Hard Shadows</h2>
        <div className="flex flex-col gap-6">
          {SHADOWS.map(s => (
            <div key={s.name} className="flex items-center gap-4">
              <div
                className="w-20 h-12 flex-shrink-0 bg-surface-container-lowest border-2 border-outline"
                style={{ boxShadow: s.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{s.name}</p>
                <p className="font-mono text-[11px] text-surface-on-variant mt-0.5">{s.value}</p>
                <p className="text-[11px] text-surface-on-variant mt-1">{s.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BORDER RADII ────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-4">Border Radii</h2>
        <div className="flex flex-col gap-4">
          {RADII.map(r => (
            <div key={r.name} className="flex items-center gap-4">
              <div
                className="w-20 h-12 flex-shrink-0 bg-primary border-2 border-outline shadow-hard"
                style={{ borderRadius: r.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{r.name}</p>
                <p className="text-[11px] text-surface-on-variant mt-0.5">
                  {r.value} — <span className="font-mono">{r.tailwind}</span>
                </p>
                <p className="text-[11px] text-surface-on-variant mt-0.5">{r.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Z-INDEX ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-[16px] font-semibold leading-6 text-surface-on mb-4">Z-Index Scale</h2>
        <div className="border-2 border-outline overflow-hidden">
          {zEntries.map(([level, value], i) => (
            <div
              key={level}
              className={`flex items-center gap-4 border-b border-outline px-3 py-2 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface'}`}
            >
              <p className="font-mono text-[12px] font-medium text-secondary w-20 flex-shrink-0 tracking-[0.04em]">Z.{level}</p>
              <p className="font-mono text-[12px] text-surface-on w-8 flex-shrink-0">{value}</p>
              <p className="text-[11px] text-surface-on-variant">
                {level === 'base'    && 'Default document flow'}
                {level === 'raised'  && 'Dropdown menus, card hover states'}
                {level === 'sticky'  && 'Sticky table headers, sidebar'}
                {level === 'overlay' && 'Side drawers, slide-over panels'}
                {level === 'modal'   && 'Modals, confirmation dialogs'}
                {level === 'toast'   && 'Toast notifications'}
                {level === 'panic'   && 'Driver panic button — always above everything'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t-2 border-outline pt-3">
        <p className="font-mono text-[11px] text-surface-on-variant tracking-[0.04em]">
          FreightProof SA — Phase 0 Token Preview · Driver PWA · DEV ONLY
        </p>
      </footer>
    </main>
  )
}
