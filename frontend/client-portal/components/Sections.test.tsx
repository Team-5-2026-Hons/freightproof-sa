import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriverSubstitutionRecord, RecordChange } from '@/lib/types'
import {
  makeAnchoredRecord, makeException, makeIncident, makeInvestigation, makeLateEvidence, makeManifest, makeSealedSeal, makeView,
} from '@/test/factories'
import { Coverage, Driver, Exceptions, Incident, Integrity, Investigations, NotShownHere, Vehicles } from './Sections'

afterEach(() => vi.restoreAllMocks())

describe('Exceptions section', () => {
  it('badges each exception with its own tier instead of a blanket recorded badge', () => {
    const anchored = makeException('seal_broken_in_transit', 'critical', { exception_id: 'a', tier: 'anchored' })
    const recorded = makeException('cargo_damage', 'warning', { exception_id: 'b', tier: 'recorded' })

    render(<Exceptions exceptions={[anchored, recorded]} onSelect={vi.fn()} />)

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Anchored')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Recorded')).toBeInTheDocument()
    expect(screen.getAllByText('Anchored')).toHaveLength(1)
  })

  it('shows no tier badge when there are no exceptions', () => {
    render(<Exceptions exceptions={[]} onSelect={vi.fn()} />)

    expect(screen.queryByText('Recorded')).not.toBeInTheDocument()
    expect(screen.getByText('No exceptions recorded.')).toBeInTheDocument()
  })

  it('summarises a pending raise as pending, never as anchored', () => {
    const pending = makeException('panic_button', 'critical', {
      tier: 'recorded',
      anchors: [{
        event_id: 'e', action: 'raised', receipt_type: 'exception_raised', anchor_status: 'pending',
        receipt_id: null, occurred_at: '2026-09-12T11:00:00Z', tier: 'recorded',
      }],
    })

    render(<Exceptions exceptions={[pending]} onSelect={vi.fn()} />)

    expect(screen.getByText(/Raised — Recorded, anchoring pending/)).toBeInTheDocument()
    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
  })

  it('keeps a failed anchor visible as retryable debt in the exceptions list', () => {
    const failed = makeException('panic_button', 'critical', {
      tier: 'recorded',
      anchors: [{
        event_id: 'e', action: 'reviewed', receipt_type: 'exception_reviewed', anchor_status: 'failed',
        receipt_id: null, occurred_at: '2026-09-12T11:00:00Z', tier: 'recorded',
      }],
    })

    render(<Exceptions exceptions={[failed]} onSelect={vi.fn()} />)

    expect(screen.getByText(/Reviewed — Recorded, anchoring failed, will retry/)).toBeInTheDocument()
  })
})

describe('Incident', () => {
  const incidentCard = (manifest = makeManifest()) => render(<Incident token="t" manifest={manifest} onSelect={vi.fn()} />)

  it('labels an exception-based incident "First critical event", with a jump to it and a red note when never reviewed', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Incident token="t" manifest={makeManifest({ incident: makeIncident({ exception_ids: ['exc-1', 'exc-2'] }) })} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Panic button' }))

    expect(screen.getByText('First critical event')).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith('exc-1')
    expect(screen.getByText('No review recorded')).toHaveClass('text-err')
  })

  it('labels an investigation-based incident as the operator’s report, with nothing to jump to and no red "No review recorded"', () => {
    const manifest = makeManifest({
      incident: makeIncident({ basis: 'investigation', exception_ids: [], first_exception_type: 'hijacking' }),
    })

    incidentCard(manifest)

    expect(screen.getByText('Reported hijacking (declared by the operator)')).toBeInTheDocument()
    expect(screen.queryByText('First critical event')).not.toBeInTheDocument()
    expect(screen.getByText('Hijacking')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hijacking' })).not.toBeInTheDocument()
    expect(screen.queryByText('No review recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('First dispatcher review')).not.toBeInTheDocument()
  })

  it('still shows a review time on an investigation-based incident when one exists', () => {
    const manifest = makeManifest({
      incident: makeIncident({
        basis: 'investigation', exception_ids: [], first_reviewed_at: '2026-09-12T11:30:00Z', minutes_to_first_review: 30,
      }),
    })

    incidentCard(manifest)

    expect(screen.getByText('First dispatcher review')).toBeInTheDocument()
    expect(screen.getByText(/30 min after/)).toBeInTheDocument()
  })

  it('hides the jump button for an exception-based incident that carries no exception ids', () => {
    incidentCard(makeManifest({ incident: makeIncident({ exception_ids: [] }) }))

    expect(screen.queryByRole('button', { name: 'Panic button' })).not.toBeInTheDocument()
    expect(screen.getByText('Panic button')).toBeInTheDocument()
  })

  it('gives its buttons a 44 px tap target', () => {
    incidentCard(makeManifest({ incident: makeIncident() }))

    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11')
  })
})

describe('Driver and Vehicles', () => {
  const substitution = (overrides: Partial<DriverSubstitutionRecord>): DriverSubstitutionRecord => ({
    substitution_id: 'sub-1', original_driver_name: 'Sipho', substituting_driver_name: 'Thabo', exchange_location: 'Harrismith',
    is_planned: true, substitution_at: '2026-09-12T08:00:00Z', anchor_receipt_id: null, tier: 'recorded', ...overrides,
  })
  const withSubstitutions = (...subs: DriverSubstitutionRecord[]) => {
    const base = makeManifest()
    return makeManifest({ driver: { ...base.driver, substitutions: subs } })
  }

  it('names the exchange location when there is one', () => {
    render(<Driver manifest={withSubstitutions(substitution({}))} />)

    expect(screen.getByText(/Sipho → Thabo at Harrismith, 12 Sep 2026 10:00 SAST/)).toBeInTheDocument()
  })

  it('does not print "at , " when the exchange location is unknown', () => {
    render(<Driver manifest={withSubstitutions(substitution({ exchange_location: null }))} />)

    const line = screen.getByText(/Sipho → Thabo/)
    expect(line).toHaveTextContent('Sipho → Thabo, 12 Sep 2026 10:00 SAST')
    expect(line).not.toHaveTextContent(/ at ,/)
    expect(line).not.toHaveTextContent('null')
  })

  it('lists two identical record changes without a duplicate-key error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const change: RecordChange = {
      subject: 'driver', subject_id: 'd-1', event_type: 'driver_updated', changed_fields: ['phone'],
      changed_at: '2026-09-12T09:00:00Z', anchor_receipt_id: null, tier: 'recorded',
    }

    render(<Vehicles manifest={makeManifest({ record_changes: [change, { ...change }] })} />)

    expect(screen.getAllByText(/Driver · phone/)).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
  })
})

describe('Integrity appendix', () => {
  it('says plainly that an unsealed pack has no seal to compare', () => {
    render(<Integrity manifest={makeManifest()} seal={makeView().seal} />)

    expect(screen.getByText(/This pack was not sealed on Hedera \(status: Anchored\)/)).toBeInTheDocument()
  })

  it('shows the fingerprints and ledger position as text, and says the seal payload matches the page', async () => {
    const seal = await makeSealedSeal()

    render(<Integrity manifest={makeManifest()} seal={seal} />)

    expect(screen.getByText(seal.manifest_sha256)).toBeInTheDocument()
    expect(screen.getByText('0.0.2002')).toBeInTheDocument()
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(screen.getByText('0.0.1@900')).toBeInTheDocument()
    expect(screen.getByText('Seal payload: manifest fingerprint').closest('div')).toHaveTextContent('matches')
    expect(screen.getByText('Seal payload: PDF fingerprint').closest('div')).toHaveTextContent('matches')
  })

  it('flags a seal payload whose fingerprints differ from the ones the page was served', async () => {
    const seal = await makeSealedSeal({ pdf_sha256: '11'.repeat(32), manifest_sha256: '22'.repeat(32) })

    render(<Integrity manifest={makeManifest()} seal={seal} />)

    const manifestRow = screen.getByText('Seal payload: manifest fingerprint').closest('div')!
    const pdfRow = screen.getByText('Seal payload: PDF fingerprint').closest('div')!
    expect(within(manifestRow).getByText('DIFFERS')).toHaveClass('text-err')
    expect(within(pdfRow).getByText('DIFFERS')).toHaveClass('text-err')
  })

  it('compares fingerprints regardless of hex case', async () => {
    const base = makeView().seal
    const seal = await makeSealedSeal({ pdf_sha256: base.pdf_sha256.toUpperCase() })

    render(<Integrity manifest={makeManifest()} seal={seal} />)

    expect(screen.getByText('Seal payload: PDF fingerprint').closest('div')).toHaveTextContent('matches')
  })

  it('says so, and logs it, when the seal payload cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const seal = await makeSealedSeal()
    seal.seal!.canonical_payload = '{not json'

    render(<Integrity manifest={makeManifest()} seal={seal} />)

    expect(screen.getByText('The seal payload could not be read as JSON.')).toBeInTheDocument()
    expect(screen.getAllByText('cannot be compared')).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
  })

  it('shows each record’s topic, sequence and transaction as text, and links only to the trusted mirror', async () => {
    const record = await makeAnchoredRecord(7)
    const seal = { ...makeView().seal, mirror_base_url: 'https://evil.example' }

    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={seal} />)

    expect(screen.getByText(/Topic 0\.0\.2002 · sequence 7 · transaction 0\.0\.1@7/)).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.2002/messages/7')
  })

  it('offers no link at all for a network it does not know', async () => {
    const record = await makeAnchoredRecord(7)
    const seal = { ...makeView().seal, hedera_network: 'devnet' }

    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={seal} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/Topic 0\.0\.2002 · sequence 7/)).toBeInTheDocument()
  })

  it('copies a payload and says "Copied"', async () => {
    const user = userEvent.setup()
    const record = await makeAnchoredRecord(1)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)

    await user.click(screen.getByRole('button', { name: 'Copy payload' }))

    expect(writeText).toHaveBeenCalledWith(record.canonical_payload)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('shows "Could not copy" when the clipboard refuses, and logs why', async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const record = await makeAnchoredRecord(1)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)

    await user.click(screen.getByRole('button', { name: 'Copy payload' }))

    expect(await screen.findByRole('button', { name: 'Could not copy' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('copy it by hand')
    expect(warn).toHaveBeenCalled()
  })

  it('handles a browser with no clipboard API the same way', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const record = await makeAnchoredRecord(1)
    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    try {
      await user.click(screen.getByRole('button', { name: 'Copy payload' }))

      await waitFor(() => expect(screen.getByRole('button', { name: 'Could not copy' })).toBeInTheDocument())
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
    }
  })

  it('gives its copy buttons a 44 px tap target', async () => {
    const record = await makeAnchoredRecord(1)

    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)

    expect(screen.getByRole('button', { name: 'Copy payload' })).toHaveClass('min-h-11')
  })
})

describe('NotShownHere', () => {
  it('counts late evidence the viewer cannot display, and says it is in the PDF', () => {
    const manifest = makeManifest({
      investigations: [makeInvestigation()],
      late_evidence: [makeLateEvidence()],
    })

    render(<NotShownHere manifest={manifest} />)

    expect(screen.getByRole('region', { name: 'Not shown in this viewer' })).toHaveTextContent(
      'This pack also contains 1 late-evidence item that this web view does not display yet. They are included in the PDF.',
    )
  })

  it('mentions only what is there', () => {
    render(<NotShownHere manifest={makeManifest({ late_evidence: [makeLateEvidence(), makeLateEvidence({ evidence_id: 'late-2' })] })} />)

    const card = screen.getByRole('region', { name: 'Not shown in this viewer' })
    expect(card).toHaveTextContent('2 late-evidence items')
    expect(card).not.toHaveTextContent('investigation')
  })

  it.each([
    ['absent on a pack frozen before v4', makeManifest()],
    ['empty lists', makeManifest({ investigations: [], late_evidence: [] })],
    ['investigations only', makeManifest({ investigations: [makeInvestigation()] })],
  ])('renders nothing for %s', (_label, manifest) => {
    const { container } = render(<NotShownHere manifest={manifest} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('Exceptions list tap targets', () => {
  it('gives the jump-to-exception button a 44 px tap target', () => {
    render(<Exceptions exceptions={[makeException('panic_button', 'critical')]} onSelect={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveClass('min-h-11')
  })
})

describe('Investigations', () => {
  it('shows each investigation with its status, affected parcels and log, as declared', () => {
    const manifest = makeManifest({
      investigations: [makeInvestigation({
        reference: 'INC-42', summary: 'Truck hijacked near Van Reenen', status: 'open',
        parcels: [{ parcel_id: 'p-1', barcode: 'FDX-1', consignment_id: 'c-1', scan_state: 'no_scan_in_recorded', latest_finding: null }],
        entries: [{
          sequence: 1, kind: 'external_action', note: null, from_value: null, to_value: null, parcel_id: null,
          exception_id: null, external_action: 'saps_reported', action_at: '2026-09-12T12:00:00Z',
          recorded_by_name: 'Thandi', recorded_at: '2026-09-12T12:05:00Z',
        }],
      })],
    })

    render(<Investigations manifest={manifest} />)

    const card = screen.getByRole('region', { name: 'Investigations' })
    expect(within(card).getByText('Declared')).toBeInTheDocument()
    expect(within(card).getByText('Truck hijacked near Van Reenen')).toBeInTheDocument()
    expect(card).toHaveTextContent('Open — not concluded when this pack was generated')
    expect(card).toHaveTextContent('1, 1 with no finding yet')
    const row = within(card).getByText('FDX-1').closest('tr')!
    expect(row).toHaveTextContent('No scan in recorded')
    expect(row).toHaveTextContent('not established')
    expect(row.textContent?.toLowerCase()).not.toContain('stolen')
    expect(card).toHaveTextContent('External action: Saps reported at 12 Sep 2026 14:00 SAST')
  })

  it('renders nothing when the pack has no investigations', () => {
    const { container } = render(<Investigations manifest={makeManifest()} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('Integrity — plain-language summary', () => {
  it('names each record in plain words before any hash, and folds the technical detail away', async () => {
    const record = await makeAnchoredRecord(1, { receipt_type: 'journey_lock', subject_type: 'trip' })

    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)

    const card = screen.getByRole('region', { name: 'Has anything been changed?' })
    const summary = within(card).getAllByRole('list')[0]
    expect(summary).toHaveTextContent('Trip plan locked when the trip was created')
    expect(summary).toHaveTextContent('Unchanged')
    expect(summary).not.toHaveTextContent(record.data_hash)
    expect(within(card).getByText(`Data hash ${record.data_hash}`).closest('details')).not.toHaveAttribute('open')
  })

  it('says plainly when a stored record no longer matches what was published', async () => {
    const record = await makeAnchoredRecord(1, { payload_matches_hash: false })

    render(<Integrity manifest={makeManifest({ anchored_records: [record] })} seal={makeView().seal} />)

    expect(screen.getByText('Changed after it was published')).toHaveClass('text-err')
  })
})

describe('Location coverage', () => {
  it('describes tracker queries by trip phase, not by the retired "handshake" model', () => {
    render(<Coverage manifest={makeManifest()} />)

    expect(screen.getByText(/the vehicle tracker is queried at each trip phase and at checkpoints/)).toBeInTheDocument()
    expect(screen.queryByText(/handshake/i)).not.toBeInTheDocument()
  })
})
