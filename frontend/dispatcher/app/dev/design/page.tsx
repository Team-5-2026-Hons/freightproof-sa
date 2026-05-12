import { notFound } from 'next/navigation'
import { TOKENS, type TokenKey } from '@shared/lib/tokens'
import { Z } from '@shared/lib/z-index'

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
  { role: 'headline-lg', size: '32px', weight: 800, spacing: '0',       sample: 'Headline Large — Page Titles' },
  { role: 'headline-md', size: '28px', weight: 700, spacing: '0',       sample: 'Headline Medium — Section Headings' },
  { role: 'headline-sm', size: '24px', weight: 700, spacing: '0',       sample: 'Headline Small — Card Titles' },
  { role: 'title-lg',    size: '22px', weight: 700, spacing: '0',       sample: 'Title Large — Card Sub-titles' },
  { role: 'title-md',    size: '16px', weight: 700, spacing: '0.01em',  sample: 'Title Medium — List Headers, Labels' },
  { role: 'title-sm',    size: '14px', weight: 700, spacing: '0.01em',  sample: 'Title Small — Chip Labels, Badges' },
  { role: 'body-lg',     size: '16px', weight: 400, spacing: '0.03em',  sample: 'Body Large — Primary body text. Driver app flows and evidence descriptions.' },
  { role: 'body-md',     size: '14px', weight: 400, spacing: '0.015em', sample: 'Body Medium — Secondary body text. Descriptions, metadata, notes.' },
  { role: 'body-sm',     size: '12px', weight: 400, spacing: '0.025em', sample: 'Body Small — Caption text. Use sparingly.' },
  { role: 'label-lg',    size: '14px', weight: 600, spacing: '0.006em', sample: 'Label Large — Metadata labels, timestamps' },
  { role: 'label-md',    size: '12px', weight: 600, spacing: '0.03em',  sample: 'Label Medium — Secondary metadata' },
  { role: 'mono-id',     size: '13px', weight: 700, spacing: '0.05em',  sample: 'TRP-2026-0041  ·  SEAL-7789-A  ·  CA 123-456' },
]

const SHADOWS = [
  { name: 'shadow-ambient-sm',     value: '0 4px 20px rgba(27, 27, 28, 0.06)',  usage: 'Compact cards, small floats, danger buttons' },
  { name: 'shadow-ambient',        value: '0 8px 40px rgba(27, 27, 28, 0.06)',  usage: 'Standard cards — the main elevation token' },
  { name: 'shadow-ambient-header', value: '0 8px 30px rgba(0, 0, 0, 0.06)',     usage: 'Sticky headers' },
  { name: 'shadow-ambient-up',     value: '0 -4px 24px rgba(0, 0, 0, 0.06)',    usage: 'Bottom CTA bars' },
  { name: 'shadow-ambient-up-lg',  value: '0 -8px 40px rgba(0, 0, 0, 0.08)',    usage: 'Bottom nav bar' },
]

const RADII = [
  { name: 'rounded-sm',   value: '2px',  usage: 'Tiny inner elements' },
  { name: 'rounded-lg',   value: '4px',  usage: 'Small inner elements' },
  { name: 'rounded-xl',   value: '8px',  usage: 'Cards, buttons, inputs, nav items' },
  { name: 'rounded-full', value: '12px', usage: 'Status pills, avatars, dots' },
]

export default function TokensPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  const zEntries = Object.entries(Z) as [keyof typeof Z, number][]

  return (
    <main className="min-h-screen bg-surface p-8 font-sans">

      <header className="mb-10 pb-6 border-b border-outline-variant/30">
        <p className="text-xs font-bold uppercase tracking-wider text-secondary mb-2">DEV ONLY — DISPATCHER</p>
        <h1 className="text-3xl font-bold text-surface-on">FreightProof Design System — Token Preview</h1>
        <p className="mt-2 text-sm text-surface-on-variant">
          Visual sign-off gate. Verify every token matches{' '}
          <span className="font-mono text-xs tracking-[0.05em]">DESIGN_SYSTEM.md §2</span> before building pages.
        </p>
      </header>

      {/* ── COLOURS ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-surface-on mb-6">Colours</h2>
        <div className="flex flex-col gap-8">
          {COLOR_GROUPS.map(group => (
            <div key={group.label}>
              <h3 className="text-xs font-bold text-surface-on-variant mb-3 uppercase tracking-wider">
                {group.label}
              </h3>
              <div className="flex flex-wrap gap-4">
                {group.keys.map(key => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <div
                      className="w-20 h-20 rounded-xl shadow-ambient-sm border border-outline-variant/20"
                      style={{ backgroundColor: TOKENS[key] }}
                      title={TOKENS[key]}
                    />
                    <p className="text-[11px] font-medium text-surface-on">{key}</p>
                    <p className="font-mono text-[11px] text-surface-on-variant tracking-[0.04em]">{TOKENS[key]}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TYPOGRAPHY ──────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-surface-on mb-6">Typography — Inter</h2>
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden">
          <div className="grid grid-cols-[160px_1fr] bg-surface-container-low border-b border-outline-variant/20">
            <div className="px-4 py-2 text-xs font-bold text-surface-on-variant uppercase tracking-wider">Role</div>
            <div className="px-4 py-2 text-xs font-bold text-surface-on-variant uppercase tracking-wider">Live Sample (Inter)</div>
          </div>
          {TYPE_SCALE.map((t, i) => (
            <div
              key={t.role}
              className={`grid grid-cols-[160px_1fr] items-center border-b border-outline-variant/10 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/40'}`}
            >
              <div className="px-4 py-3 border-r border-outline-variant/20">
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{t.role}</p>
                <p className="text-[10px] text-surface-on-variant mt-0.5">{t.size} / w{t.weight}</p>
              </div>
              <div className="px-4 py-3 overflow-hidden">
                <span
                  style={{
                    fontSize: t.size,
                    fontWeight: t.weight,
                    letterSpacing: t.spacing,
                    fontFamily: 'var(--font-inter)',
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
        <h2 className="text-xl font-bold text-surface-on mb-2">Ambient Shadows</h2>
        <p className="text-sm text-surface-on-variant mb-6">Soft, large-radius Gaussian. No hard offset shadows anywhere.</p>
        <div className="flex flex-wrap gap-10">
          {SHADOWS.map(s => (
            <div key={s.name} className="flex flex-col gap-3">
              <div
                className="w-32 h-16 bg-surface-container-lowest rounded-xl"
                style={{ boxShadow: s.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{s.name}</p>
                <p className="font-mono text-[11px] text-surface-on-variant mt-0.5 max-w-[200px] break-all">{s.value}</p>
                <p className="text-[11px] text-surface-on-variant mt-1 max-w-[160px]">{s.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BORDER RADII ────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-surface-on mb-6">Border Radii</h2>
        <div className="flex flex-wrap gap-10">
          {RADII.map(r => (
            <div key={r.name} className="flex flex-col gap-3">
              <div
                className="w-24 h-16 bg-primary shadow-ambient-sm"
                style={{ borderRadius: r.value }}
              />
              <div>
                <p className="font-mono text-[11px] font-medium text-secondary tracking-[0.04em]">{r.name}</p>
                <p className="text-[11px] text-surface-on-variant mt-0.5">{r.value}</p>
                <p className="text-[11px] text-surface-on-variant mt-1 max-w-[140px]">{r.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── GLASSMORPHISM ───────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-surface-on mb-2">Glassmorphism</h2>
        <p className="text-sm text-surface-on-variant mb-6">
          Used on sticky headers and bottom nav only — never on cards or content.
        </p>
        <div
          className="glass-nav rounded-xl px-6 py-4 border border-outline-variant/20"
          style={{ backgroundImage: 'linear-gradient(135deg, #0051d520, #1a7c3e20)' }}
        >
          <p className="text-sm font-bold text-surface-on">.glass-nav</p>
          <p className="text-xs text-surface-on-variant mt-1">background: rgba(252,248,249,0.8) · backdrop-filter: blur(12px)</p>
        </div>
      </section>

      {/* ── Z-INDEX ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-surface-on mb-6">Z-Index Scale</h2>
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden">
          <div className="grid grid-cols-[120px_80px_1fr] bg-surface-container-low border-b border-outline-variant/20">
            <div className="px-4 py-2 text-xs font-bold text-surface-on-variant uppercase tracking-wider">Level</div>
            <div className="px-4 py-2 text-xs font-bold text-surface-on-variant uppercase tracking-wider">Value</div>
            <div className="px-4 py-2 text-xs font-bold text-surface-on-variant uppercase tracking-wider">Usage</div>
          </div>
          {zEntries.map(([level, value], i) => (
            <div
              key={level}
              className={`grid grid-cols-[120px_80px_1fr] items-center border-b border-outline-variant/10 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/40'}`}
            >
              <div className="px-4 py-2 font-mono text-sm font-medium text-secondary tracking-[0.04em]">Z.{level}</div>
              <div className="px-4 py-2 font-mono text-sm text-surface-on">{value}</div>
              <div className="px-4 py-2 text-sm text-surface-on-variant">
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
        <h2 className="text-xl font-bold text-surface-on mb-6">Quick Reference</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Page background',       value: 'surface #fcf8f9',               color: TOKENS.surface },
            { label: 'Card background',        value: 'surface-container-lowest #fff', color: TOKENS.surfaceContainerLowest },
            { label: 'Primary text',           value: 'on-surface #1b1b1c',            color: TOKENS.onSurface },
            { label: 'Secondary text',         value: 'on-surface-variant #46474a',    color: TOKENS.onSurfaceVariant },
            { label: 'Verified / active',      value: 'secondary #0051d5',             color: TOKENS.secondary },
            { label: 'Seal intact / success',  value: 'success #1a7c3e',              color: TOKENS.success },
            { label: 'Exception / error',      value: 'error #ba1a1a',                 color: TOKENS.error },
            { label: 'Warning / in-progress',  value: 'tertiary-fixed-dim #ffb95f',    color: TOKENS.tertiaryFixedDim },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 bg-surface-container-lowest rounded-xl shadow-ambient-sm p-3">
              <div className="w-8 h-8 flex-shrink-0 rounded-lg border border-outline-variant/20" style={{ backgroundColor: item.color }} />
              <div>
                <p className="text-xs font-medium text-surface-on">{item.label}</p>
                <p className="font-mono text-[11px] text-surface-on-variant mt-0.5">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-outline-variant/30 pt-4 mt-8">
        <p className="text-xs text-surface-on-variant">
          FreightProof SA — Token Preview · Dispatcher · DEV ONLY
        </p>
      </footer>

    </main>
  )
}
