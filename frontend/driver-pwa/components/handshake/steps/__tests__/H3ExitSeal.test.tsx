// frontend/driver-pwa/components/handshake/steps/__tests__/H3ExitSeal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { H3ExitSeal, sealsMatch } from '../H3ExitSeal'
import type { H3Evidence } from '@/lib/types/evidence-draft'

// StepHeader (rendered by the step) calls useRouter and useParams — stub both so the
// component mounts under jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ h: '3', slug: '2-confirm-seal' }),
}))

// Locks in the comparison logic behind H3's "confirm seal" exception flag (commit c1a8c2b),
// covering the branch set flagged in code-quality review: match / case-insensitive match /
// mismatch / indeterminate (null h2SealNumber) / empty input. A prior bug in this exact area
// was a drift between the live indicator's comparison and the persisted sealVerifiedMatch value —
// this suite tests the single shared helper both call, so that class of bug can't recur silently.
describe('sealsMatch', () => {
  it('returns true for an exact match', () => {
    expect(sealsMatch('FP-1234', 'FP-1234')).toBe(true)
  })

  it('returns true for a case-insensitive match', () => {
    expect(sealsMatch('fp-1234', 'FP-1234')).toBe(true)
  })

  it('returns true when only whitespace differs', () => {
    expect(sealsMatch('  FP-1234  ', 'FP-1234')).toBe(true)
  })

  it('returns false for a mismatch', () => {
    expect(sealsMatch('FP-1234', 'FP-5678')).toBe(false)
  })

  it('returns false when h2SealNumber is null (indeterminate reference)', () => {
    expect(sealsMatch('FP-1234', null)).toBe(false)
  })

  it('returns false when driver input is empty', () => {
    expect(sealsMatch('', 'FP-1234')).toBe(false)
  })

  it('returns false when both input and reference are empty/null', () => {
    expect(sealsMatch('', null)).toBe(false)
  })
})

// Audit fix: H3 had drifted from its siblings. (a) H2/H4 gate readiness on
// isValidSealFormat() (backend 422s any seal not matching XX-####) while H3 accepted any
// non-empty text; (b) H3 rendered match/mismatch/no-reference in one neutral box differing
// only by icon color, while H4 gives mismatch a bg-error-container alert card and match a
// success tint. These tests pin both the format gate and H4's visual language onto H3.

const FORMAT_HINT = 'Seal number must look like AB-1234 (two letters, four digits).'
const MISMATCH_TEXT = 'Mismatch — flagged as exception'
const MATCH_TEXT = 'Seal matches'
const NO_REFERENCE_TEXT =
  'No seal is on record on this device — the number you enter is verified against the loading seal when you submit.'

function makeDraft(overrides: Partial<H3Evidence> = {}): H3Evidence {
  return {
    gpsLat: null,
    gpsLng: null,
    sealNumberConfirmed: null,
    sealVerifiedMatch: null,
    capturedAt: null,
    ...overrides,
  }
}

interface RenderOverrides {
  draft?: H3Evidence
  h2SealNumber?: string | null
  onUpdate?: (patch: Partial<H3Evidence>) => void
}

// H3 is fully controlled by the draft prop (no local input state, unlike H4), so tests
// drive UI states by rendering with a pre-filled draft rather than firing change events.
function renderStep({ draft = makeDraft(), h2SealNumber = null, onUpdate = vi.fn() }: RenderOverrides = {}) {
  return render(
    <H3ExitSeal tripId="t1" draft={draft} h2SealNumber={h2SealNumber} onUpdate={onUpdate} onComplete={vi.fn()} />,
  )
}

// The state card is the styled wrapper around the indicator text: text → <p> → card div.
function getCardOf(text: string): HTMLElement {
  const card = screen.getByText(text).parentElement
  if (!card) throw new Error(`state card for "${text}" not found`)
  return card
}

describe('H3ExitSeal seal-format gating', () => {
  it('shows the format hint for a malformed seal number', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'ABC123' }) })

    expect(screen.getByText(FORMAT_HINT)).toBeInTheDocument()
  })

  it('hides the format hint for a well-formed seal number', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'FP-1234' }) })

    expect(screen.queryByText(FORMAT_HINT)).not.toBeInTheDocument()
  })

  it('hides the format hint while the input is still empty', () => {
    renderStep()

    // An untouched field is not an error yet — same behavior as H2Seal's showFormatHint.
    expect(screen.queryByText(FORMAT_HINT)).not.toBeInTheDocument()
  })

  it('disables the hold button for a malformed seal number', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'ABC123' }) })

    expect(screen.getByRole('button', { name: /hold to confirm/i })).toBeDisabled()
  })

  it('enables the hold button for a well-formed MISMATCHING seal', () => {
    // Behavioral contract: a mismatch is flagged, never blocked — the driver must still
    // be able to depart; only a format error (a guaranteed backend 422) blocks the hold.
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'FP-9999' }), h2SealNumber: 'FP-1234' })

    expect(screen.getByRole('button', { name: /hold to confirm/i })).toBeEnabled()
  })
})

describe('H3ExitSeal state-card visual language (H4 parity)', () => {
  it('renders the mismatch state as an error alert card', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'FP-9999' }), h2SealNumber: 'FP-1234' })

    const card = getCardOf(MISMATCH_TEXT)

    // A mismatch flags a CRITICAL seal exception — it must carry H4's full
    // bg-error-container treatment, not just a red icon in a neutral box.
    expect(card.className).toContain('bg-error-container')
  })

  it('renders the match state with the success tint', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'FP-1234' }), h2SealNumber: 'FP-1234' })

    const card = getCardOf(MATCH_TEXT)

    expect(card.className).toContain('bg-success/10')
  })

  it('renders the no-reference state as a neutral card, not an error', () => {
    renderStep({ draft: makeDraft({ sealNumberConfirmed: 'FP-1234' }), h2SealNumber: null })

    const card = getCardOf(NO_REFERENCE_TEXT)

    expect(card.className).toContain('bg-surface-container-low')
    expect(card.className).not.toContain('bg-error-container')
  })

  it('shows no state card while the input is empty', () => {
    renderStep({ h2SealNumber: 'FP-1234' })

    expect(screen.queryByText(MATCH_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(MISMATCH_TEXT)).not.toBeInTheDocument()
  })
})

describe('H3ExitSeal draft persistence', () => {
  it('uppercases input and persists the three-way match state on change', () => {
    const onUpdate = vi.fn()
    renderStep({ h2SealNumber: 'FP-1234', onUpdate })

    fireEvent.change(screen.getByPlaceholderText('e.g. FP-1234'), { target: { value: 'fp-1234' } })

    expect(onUpdate).toHaveBeenLastCalledWith({
      sealNumberConfirmed: 'FP-1234',
      sealVerifiedMatch: true,
    })
  })

  it('persists sealVerifiedMatch as null (indeterminate) when no reference exists', () => {
    const onUpdate = vi.fn()
    renderStep({ h2SealNumber: null, onUpdate })

    fireEvent.change(screen.getByPlaceholderText('e.g. FP-1234'), { target: { value: 'FP-1234' } })

    expect(onUpdate).toHaveBeenLastCalledWith({
      sealNumberConfirmed: 'FP-1234',
      sealVerifiedMatch: null,
    })
  })
})
