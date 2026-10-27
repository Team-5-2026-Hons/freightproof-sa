import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAnchoredRecord, makeSealedSeal, makeView } from '@/test/factories'
import type { LiveVerification } from '@/lib/types'
import type { AnchorCheckResult } from '@/lib/verify'
import { VerificationPanel } from './VerificationPanel'

const TESTNET = 'https://testnet.mirrornode.hedera.com'

function mirrorMessage(hash: string, sequence: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ message: btoa(hash), consensus_timestamp: '1757656800.0', topic_id: '0.0.2002', sequence_number: sequence, ...extra }))
}

/** Answers each mirror URL by its sequence number; anything else (the live check) via `others`. */
function stubFetch(byHashSequence: (sequence: number, url: string) => Response | Promise<Response>, others?: (url: string) => Response) {
  const fetchStub = vi.fn(async (input: string) => {
    const url = String(input)
    if (url.includes('/api/v1/topics/')) return byHashSequence(Number(url.split('/').pop()), url)
    if (others) return others(url)
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function section(): HTMLElement {
  return screen.getByRole('heading', { level: 3 }).closest('section')!
}

describe('VerificationPanel — the seal row', () => {
  it('always renders the pack seal first, and says plainly when the pack was not sealed', async () => {
    const records = [await makeAnchoredRecord(1), await makeAnchoredRecord(2)]
    stubFetch((sequence) => mirrorMessage(records[sequence - 1].data_hash, sequence))

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByText('Pack seal · FP-AUDIT-AP1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('This pack was not sealed on Hedera (status: Anchored)')).toHaveClass('text-warn')
    expect(await screen.findByText('Pack not sealed · 2 of 2 records verified in your browser')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This pack was not sealed on the public ledger' })).toBeInTheDocument()
  })

  it('is NOT green when the seal is missing, even though every record verified', async () => {
    const records = [await makeAnchoredRecord(1)]
    stubFetch((sequence) => mirrorMessage(records[sequence - 1].data_hash, sequence))

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    await screen.findByText('1 of 1 record verified in your browser', { exact: false })
    await waitFor(() => expect(within(section()).getByText(/Verified on Hedera/)).toBeInTheDocument())
    expect(section()).not.toHaveClass('border-ok')
    expect(section()).toHaveClass('border-warn')
  })

  it('goes green only when the seal AND every record verify', async () => {
    const records = [await makeAnchoredRecord(1), await makeAnchoredRecord(2), await makeAnchoredRecord(3)]
    const seal = await makeSealedSeal()
    stubFetch((sequence) => (sequence === 900
      ? mirrorMessage(seal.seal!.data_hash, 900)
      : mirrorMessage(records[sequence - 1].data_hash, sequence)))

    render(<VerificationPanel token="tok" seal={seal} records={records} />)

    expect(await screen.findByText('Seal verified · 3 of 3 records verified in your browser')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unchanged since it was issued' })).toBeInTheDocument()
    expect(section()).toHaveClass('border-ok')
    expect(section()).not.toHaveClass('border-err')
  })

  it('is not green when the seal verifies but a record cannot be confirmed', async () => {
    const records = [await makeAnchoredRecord(1), await makeAnchoredRecord(2)]
    const seal = await makeSealedSeal()
    stubFetch((sequence) => {
      if (sequence === 2) return new Response('busy', { status: 503 })
      return mirrorMessage(sequence === 900 ? seal.seal!.data_hash : records[sequence - 1].data_hash, sequence)
    })

    render(<VerificationPanel token="tok" seal={seal} records={records} />)

    expect(await screen.findByText('Seal verified · 1 of 2 records verified in your browser')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Not confirmed against the public ledger yet' })).toBeInTheDocument()
    expect(section()).not.toHaveClass('border-ok')
  })

  it('reports the seal result to the page so the PDF check can use it', async () => {
    const seal = await makeSealedSeal()
    stubFetch((sequence) => mirrorMessage(seal.seal!.data_hash, sequence))
    const onSealCheck = vi.fn<(result: AnchorCheckResult) => void>()

    render(<VerificationPanel token="tok" seal={seal} records={[]} onSealCheck={onSealCheck} />)

    await waitFor(() => expect(onSealCheck).toHaveBeenCalledWith(expect.objectContaining({ state: 'verified' })))
  })

  it('reports an unsealed pack to the page as no_receipt', async () => {
    stubFetch(() => { throw new Error('no network expected') })
    const onSealCheck = vi.fn<(result: AnchorCheckResult) => void>()

    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} onSealCheck={onSealCheck} />)

    await waitFor(() => expect(onSealCheck).toHaveBeenCalledWith({ state: 'no_receipt' }))
  })
})

describe('VerificationPanel — failures and states', () => {
  it('reports a failure when Hedera holds a different hash', async () => {
    const records = [await makeAnchoredRecord(1)]
    stubFetch((sequence) => mirrorMessage('ff'.repeat(32), sequence))

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    expect(await screen.findByText('Pack not sealed · 1 record failed verification')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Something in this pack does not match the public ledger' })).toBeInTheDocument()
    expect(screen.getByText(/Hedera holds a different hash/)).toBeInTheDocument()
    expect(section()).toHaveClass('border-err')
  })

  it('shows a mirror 404 as "no message at this position", not as unreachable or tampering', async () => {
    const records = [await makeAnchoredRecord(1)]
    stubFetch(() => new Response('{}', { status: 404 }))

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    const text = await screen.findByText(/No message at this ledger position/)
    expect(text).toHaveTextContent('not evidence of tampering (ledger reset or wrong position)')
    expect(text).toHaveClass('text-warn')
    expect(screen.queryByText(/unreachable/)).not.toBeInTheDocument()
  })

  it('shows an unsupported browser plainly', async () => {
    const records = [await makeAnchoredRecord(1)]
    vi.stubGlobal('crypto', {})
    stubFetch(() => { throw new Error('no network expected') })

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    expect((await screen.findAllByText('This browser cannot verify (needs a secure HTTPS page)')).length).toBeGreaterThan(0)
  })

  it('checks the trusted mirror, whatever address the server names, and says which host it used', async () => {
    const records = [await makeAnchoredRecord(1)]
    const fetchStub = stubFetch((sequence) => mirrorMessage(records[0].data_hash, sequence))
    const seal = { ...makeView().seal, mirror_base_url: 'https://evil.example' }

    render(<VerificationPanel token="tok" seal={seal} records={records} />)

    await screen.findByText(/Verified on Hedera/)
    expect(fetchStub).toHaveBeenCalled()
    for (const [url] of fetchStub.mock.calls) expect(String(url).startsWith(TESTNET)).toBe(true)
    expect(screen.getByText(/Mirror node: testnet\.mirrornode\.hedera\.com/)).toBeInTheDocument()
  })

  it('makes no ledger request, and says so, for a network the portal does not know', async () => {
    const records = [await makeAnchoredRecord(1)]
    const fetchStub = stubFetch(() => { throw new Error('no network expected') })
    const seal = { ...makeView().seal, hedera_network: 'devnet' }

    render(<VerificationPanel token="tok" seal={seal} records={records} />)

    expect(await screen.findByText(/No trusted mirror node is known for the network “devnet”/)).toBeInTheDocument()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('states exactly what was checked, and what it does not prove', async () => {
    stubFetch(() => { throw new Error('no network expected') })

    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} />)

    expect(await screen.findByText(/confirmed the Hedera testnet ledger holds that hash at the recorded position/)).toBeInTheDocument()
    expect(screen.getByText(/does not by itself prove every figure on this page came from them/)).toBeInTheDocument()
    expect(screen.queryByText(/FreightProof's servers were not involved/)).not.toBeInTheDocument()
  })

  it('announces its headline politely to assistive technology', async () => {
    stubFetch(() => { throw new Error('no network expected') })

    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} />)

    expect(await screen.findByRole('heading', { level: 3 })).toHaveAttribute('aria-live', 'polite')
  })
})

describe('VerificationPanel — running the checks', () => {
  it('never has more than four ledger requests in flight', async () => {
    const records = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => makeAnchoredRecord(n)))
    let inFlight = 0
    let peak = 0
    stubFetch(async (sequence) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return mirrorMessage(records[sequence - 1].data_hash, sequence)
    })

    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    expect(await screen.findByText(/8 of 8 records verified/)).toBeInTheDocument()
    expect(peak).toBe(4)
  })

  it('re-runs only the rows that are not verified', async () => {
    const user = userEvent.setup()
    const records = [await makeAnchoredRecord(1), await makeAnchoredRecord(2)]
    let secondAttempts = 0
    const fetchStub = stubFetch((sequence) => {
      if (sequence === 2 && secondAttempts++ === 0) return new Response('busy', { status: 503 })
      return mirrorMessage(records[sequence - 1].data_hash, sequence)
    })
    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)
    await screen.findByText('Pack not sealed · 1 of 2 records verified in your browser')
    fetchStub.mockClear()

    await user.click(screen.getByRole('button', { name: 'Re-run browser check' }))

    expect(await screen.findByText('Pack not sealed · 2 of 2 records verified in your browser')).toBeInTheDocument()
    expect(fetchStub.mock.calls.map(([url]) => String(url).split('/').pop())).toEqual(['2'])
  })

  it('ignores the answer of a run that a re-run has superseded', async () => {
    const user = userEvent.setup()
    const records = [await makeAnchoredRecord(1)]
    let releaseStale!: (response: Response) => void
    let call = 0
    stubFetch(() => {
      call += 1
      if (call === 1) return new Promise<Response>((resolve) => { releaseStale = resolve })
      return mirrorMessage(records[0].data_hash, 1)
    })
    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)
    await waitFor(() => expect(call).toBe(1))

    await user.click(screen.getByRole('button', { name: 'Re-run browser check' }))
    await screen.findByText('Pack not sealed · 1 of 1 record verified in your browser')
    releaseStale(mirrorMessage('ff'.repeat(32), 1))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByText(/1 of 1 record verified/)).toBeInTheDocument()
    expect(screen.queryByText(/Hedera holds a different hash/)).not.toBeInTheDocument()
  })

  it('disables the re-run button when there is nothing left to re-check', async () => {
    const seal = await makeSealedSeal()
    stubFetch((sequence) => mirrorMessage(seal.seal!.data_hash, sequence))

    render(<VerificationPanel token="tok" seal={seal} records={[]} />)

    await screen.findByText('Seal verified · no other anchored records')
    expect(screen.getByRole('button', { name: 'Re-run browser check' })).toBeDisabled()
  })

  it('gives every button a 44 px tap target', async () => {
    stubFetch(() => { throw new Error('no network expected') })

    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} />)

    for (const button of await screen.findAllByRole('button')) expect(button).toHaveClass('min-h-11')
  })
})

describe('VerificationPanel — live check against FreightProof', () => {
  const live = (overrides: Partial<LiveVerification>): LiveVerification => ({
    checked_at: '2026-09-12T12:32:00Z', seal_status: 'verified', records: [], records_added_since_issue: 0, ...overrides,
  })
  const liveRecord = (n: number, status: LiveVerification['records'][number]['status']) => ({
    receipt_id: `r-${n}`, subject_type: 'phase_event', subject_id: `s-${n}`, status,
  })

  async function runLiveCheck(result: LiveVerification) {
    const user = userEvent.setup()
    stubFetch(() => { throw new Error('no ledger request expected') }, () => new Response(JSON.stringify(result), { status: 200 }))
    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} />)
    await user.click(screen.getByRole('button', { name: /Check live records have not changed/ }))
    return screen.findByText(/Live check \(/)
  }

  it('labels the time with its real offset instead of calling a UTC slice "UTC"', async () => {
    const summary = await runLiveCheck(live({ records: [liveRecord(1, 'verified')] }))

    expect(summary).toHaveTextContent('Live check (12 Sep 2026 14:32 SAST)')
    expect(summary).not.toHaveTextContent('UTC')
  })

  it('gives each kind of non-verified record its own wording and tone', async () => {
    await runLiveCheck(live({
      seal_status: 'hedera_mismatch',
      records: [liveRecord(1, 'db_mismatch'), liveRecord(2, 'hedera_mismatch'), liveRecord(3, 'error'), liveRecord(4, 'no_receipt'), liveRecord(5, 'verified')],
    }))

    expect(screen.getByText(/Live records that no longer match their anchor: 1/)).toHaveClass('text-err')
    expect(screen.getByText(/Live records that do not match what Hedera holds: 1/)).toHaveClass('text-err')
    expect(screen.getByText(/Live records that could not be checked just now: 1/)).toHaveClass('text-warn')
    expect(screen.getByText(/Live records with no ledger receipt to check: 1/)).toHaveClass('text-warn')
    expect(screen.getByText(/pack seal does not match Hedera/)).toBeInTheDocument()
  })

  it('says nothing about problems when every live record is unchanged', async () => {
    await runLiveCheck(live({ records: [liveRecord(1, 'verified')] }))

    expect(screen.queryByText(/Live records that/)).not.toBeInTheDocument()
    expect(screen.getByText(/1 of 1 anchored records unchanged/)).toBeInTheDocument()
  })

  it('tells the reader when the live check itself could not run, and logs why', async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubFetch(() => { throw new Error('no ledger request expected') }, () => new Response('{}', { status: 503 }))
    render(<VerificationPanel token="tok" seal={makeView().seal} records={[]} />)

    await user.click(screen.getByRole('button', { name: /Check live records have not changed/ }))

    expect(await screen.findByText('The live re-check could not run. Try again later.')).toBeInTheDocument()
    expect(warn).toHaveBeenCalled()
  })
})
