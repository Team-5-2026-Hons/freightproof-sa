import { notFound } from 'next/navigation'
import { TOKENS, type TokenKey } from '@shared/lib/tokens'
import { Z } from '@shared/lib/z-index'

const COLOR_GROUPS: { label: string; keys: TokenKey[] }[] = [
  { label: 'Primary — Tarmac',        keys: ['primary', 'primaryContainer', 'onPrimary', 'onPrimaryContainer'] },
  { label: 'Secondary — Signal Orange', keys: ['secondary', 'secondaryContainer', 'onSecondary', 'onSecondaryContainer'] },
  { label: 'Tertiary — Caution Yellow', keys: ['tertiary', 'tertiaryContainer', 'onTertiary', 'onTertiaryContainer', 'tertiaryFixedDim'] },
  { label: 'Success — Phosphor Green', keys: ['success', 'successContainer', 'onSuccess', 'onSuccessContainer'] },
  { label: 'Error — Emergency Red',   keys: ['error', 'errorContainer', 'onError', 'onErrorContainer'] },
  { label: 'Surface Hierarchy',       keys: ['surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant'] },
  { label: 'Outline',                 keys: ['outline', 'outlineVariant'] },
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
  if (process.env.NODE_ENV !== 'development') notFound()

  const zEntries = Object.entries(Z) as [keyof typeof Z, number][]

  return (
    <main className="min-h-screen bg-surface p-8 font-sans">
      <header className="mb-10 border-b-2 border-outline pb-6">
        <p className="font-mono text-[13px] font-medium tracking-[0.05em] text-secondary mb-2">DEV ONLY — DISPATCHER</p>
        <h1 className="text-[32px] font-semibold leading-10 text-surface-on">
          FreightProof Design System — Token Preview
        </h1>
        <p className="mt-2 text-[14px] leading-5 text-surface-on-variant">
          Phase 0 visual sign-off gate. Verify every colour matches{' '}
          <span className="font-mono text-[13px]">DESIGN_SYSTEM.md §2.2</span> before proceeding to Phase 1.
        </p>
      </header>

      {/* ── COLOURS ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Colours</h2>
        <div className="flex flex-col gap-8">
          {COLOR_GROUPS.map(group => (
            <div key={group.label}>
              <h3 className="text-[14px] font-semibold leading-5 tracking-[0.01em] text-surface-on-variant mb-3 uppercase">
                {group.label}
              </h3>
              <div className="flex flex-wrap gap-4">
                {group.keys.map(key => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <div
                      className="w-20 h-20 border-2 border-outline"
                      style={{ backgroundColor: TOKENS[key] }}
                      title={TOKENS[key]}
                    />
                    <p className="text-[11px] font-medium leading-4 text-surface-on tracking-[0.03em]">{key}</p>
                    <p className="font-mono text-[11px] leading-4 text-surface-on-variant tracking-[0.04em]">{TOKENS[key]}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TYPOGRAPHY ──────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Typography Scale</h2>
        <div className="border-2 border-outline overflow-hidden">
          <div className="grid grid-cols-[160px_1fr] border-b-2 border-outline bg-primary-container">
            <div className="px-4 py-2 text-[11px] font-semibold text-on-primary-container uppercase tracking-[0.08em]">Role</div>
            <div className="px-4 py-2 text-[11px] font-semibold text-on-primary-container uppercase tracking-[0.08em]">Live Sample</div>
          </div>
          {TYPE_SCALE.map((t, i) => (
            <div
              key={t.role}
              className={`grid grid-cols-[160px_1fr] items-center border-b border-outline ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface'}`}
            >
              <div className="px-4 py-3 border-r-2 border-outline">
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{t.role}</p>
                <p className="text-[10px] text-surface-on-variant mt-0.5 leading-3">
                  {t.size} / {t.weight} / {t.spacing || '0'}
                </p>
              </div>
              <div className="px-4 py-3 overflow-hidden">
                <span
                  style={{
                    fontSize: t.size,
                    lineHeight: t.lineHeight,
                    fontWeight: t.weight,
                    letterSpacing: t.spacing,
                    fontFamily: t.family === 'mono' ? 'var(--font-ibm-plex-mono)' : 'var(--font-space-grotesk)',
                  }}
                  className="text-surface-on block truncate"
                >
                  {t.sample}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SHADOWS ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Hard Shadows</h2>
        <div className="flex flex-wrap gap-10">
          {SHADOWS.map(s => (
            <div key={s.name} className="flex flex-col gap-3">
              <div
                className="w-32 h-16 bg-surface-container-lowest border-2 border-outline"
                style={{ boxShadow: s.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{s.name}</p>
                <p className="font-mono text-[11px] text-surface-on-variant mt-0.5">{s.value}</p>
                <p className="text-[11px] text-surface-on-variant mt-1 max-w-[140px]">{s.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BORDER RADII ────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Border Radii</h2>
        <div className="flex flex-wrap gap-10">
          {RADII.map(r => (
            <div key={r.name} className="flex flex-col gap-3">
              <div
                className="w-24 h-16 bg-primary border-2 border-outline shadow-hard"
                style={{ borderRadius: r.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{r.name}</p>
                <p className="text-[11px] text-surface-on-variant mt-0.5">{r.value} — <span className="font-mono">{r.tailwind}</span></p>
                <p className="text-[11px] text-surface-on-variant mt-1 max-w-[140px]">{r.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Z-INDEX ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Z-Index Scale</h2>
        <div className="border-2 border-outline inline-block overflow-hidden">
          <div className="grid grid-cols-[120px_80px_1fr] border-b-2 border-outline bg-primary-container">
            <div className="px-4 py-2 text-[11px] font-semibold text-on-primary-container uppercase tracking-[0.08em]">Level</div>
            <div className="px-4 py-2 text-[11px] font-semibold text-on-primary-container uppercase tracking-[0.08em]">Value</div>
            <div className="px-4 py-2 text-[11px] font-semibold text-on-primary-container uppercase tracking-[0.08em]">Usage</div>
          </div>
          {zEntries.map(([level, value], i) => (
            <div
              key={level}
              className={`grid grid-cols-[120px_80px_1fr] items-center border-b border-outline ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface'}`}
            >
              <div className="px-4 py-2 font-mono text-[12px] font-medium text-secondary tracking-[0.04em]">Z.{level}</div>
              <div className="px-4 py-2 font-mono text-[12px] text-surface-on">{value}</div>
              <div className="px-4 py-2 text-[12px] text-surface-on-variant">
                {level === 'base'    && 'Default document flow'}
                {level === 'raised'  && 'Dropdown menus, card hover states'}
                {level === 'sticky'  && 'Sticky table headers, sidebar'}
                {level === 'overlay' && 'Side drawers, slide-over panels'}
                {level === 'modal'   && 'Modals, confirmation dialogs'}
                {level === 'toast'   && 'Toast notifications'}
                {level === 'panic'   && 'Driver panic button — always above everything'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── QUICK REFERENCE ─────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-[22px] font-semibold leading-7 text-surface-on mb-6">Quick Reference — §17</h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Page background',     value: 'surface #EFEFE9',            color: TOKENS.surface },
            { label: 'Card background',      value: 'surface-container-lowest #ffffff', color: TOKENS.surfaceContainerLowest },
            { label: 'Primary text',         value: 'on-surface #1A1A1A',         color: TOKENS.onSurface },
            { label: 'Secondary text',       value: 'on-surface-variant #4D4D4D', color: TOKENS.onSurfaceVariant },
            { label: 'Verified / complete',  value: 'secondary #FF4F00',          color: TOKENS.secondary },
            { label: 'Seal intact / success', value: 'success #00D640',           color: TOKENS.success },
            { label: 'Exception / error',    value: 'error #FF2A00',              color: TOKENS.error },
            { label: 'Warning / in-progress', value: 'tertiary-fixed-dim #FFC200', color: TOKENS.tertiaryFixedDim },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 border-2 border-outline p-3 bg-surface-container-lowest">
              <div className="w-8 h-8 flex-shrink-0 border border-outline" style={{ backgroundColor: item.color }} />
              <div>
                <p className="text-[12px] font-medium text-surface-on">{item.label}</p>
                <p className="font-mono text-[11px] text-surface-on-variant mt-0.5">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t-2 border-outline pt-4 mt-8">
        <p className="font-mono text-[11px] text-surface-on-variant tracking-[0.04em]">
          FreightProof SA — Phase 0 Token Preview · Dispatcher · DEV ONLY
        </p>
      </footer>
    </main>
  )
}
