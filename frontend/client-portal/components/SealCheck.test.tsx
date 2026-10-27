import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSealedSeal, makeView } from '@/test/factories'
import type { PublicPackSeal } from '@/lib/types'
import { SealCheck } from './SealCheck'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const mirrorMessage = (hash: string) => json(200, { message: btoa(hash), consensus_timestamp: '1757656800.0', topic_id: '0.0.2002', sequence_number: 900 })

/** Routes the seal endpoint and the mirror separately, so each test scripts only what it cares about. */
function stubApi(handlers: { seal?: () => Response; mirror?: () => Response | Promise<Response> }) {
  const fetchStub = vi.fn(async (input: string) => {
    const url = String(input)
    if (url.includes('/audit-packs/seal/')) return handlers.seal ? handlers.seal() : json(500, {})
    if (url.includes('/api/v1/topics/')) return handlers.mirror ? handlers.mirror() : json(500, {})
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

describe('SealCheck — loading the seal', () => {
  it('says no pack has this identifier on a 404', async () => {
    stubApi({ seal: () => json(404, { detail: 'Audit pack not found.' }) })

    render(<SealCheck packId="nope" />)

    expect(await screen.findByText('No audit pack has this identifier.')).toBeInTheDocument()
  })

  it('says the identifier is not valid on a 422, not the generic message', async () => {
    stubApi({ seal: () => json(422, { detail: [{ loc: ['path', 'pack_id'], msg: 'Input should be a valid UUID', type: 'uuid_parsing' }] }) })

    render(<SealCheck packId="not-a-uuid" />)

    expect(await screen.findByText(/not a valid audit pack identifier/)).toBeInTheDocument()
    expect(screen.queryByText('The seal could not be loaded.')).not.toBeInTheDocument()
  })

  it('asks the reader to wait on a 429', async () => {
    stubApi({ seal: () => json(429, { detail: 'Too many requests. Please slow down and try again shortly.' }) })

    render(<SealCheck packId="busy" />)

    expect(await screen.findByText('Too many requests — try again shortly.')).toBeInTheDocument()
  })

  it('keeps the generic message for any other failure', async () => {
    stubApi({ seal: () => json(500, {}) })

    render(<SealCheck packId="broken" />)

    expect(await screen.findByText('The seal could not be loaded.')).toBeInTheDocument()
  })
})

describe('SealCheck — the seal itself', () => {
  it('verifies a seal that Hedera holds', async () => {
    const seal = await makeSealedSeal()
    stubApi({ seal: () => json(200, seal), mirror: () => mirrorMessage(seal.seal!.data_hash) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('Seal verified on Hedera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
  })

  it('says a pack with no seal receipt was not sealed, with its anchoring status', async () => {
    stubApi({ seal: () => json(200, { ...makeView().seal, anchor_status: 'pending' }) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('This pack was not sealed on Hedera (status: Pending)')).toBeInTheDocument()
  })

  it('says "Expired on" once the link is past its expiry, instead of "Valid until"', async () => {
    const seal: PublicPackSeal = { ...makeView().seal, expires_at: '2020-01-02T10:00:00Z' }
    stubApi({ seal: () => json(200, seal) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('Expired on 02 Jan 2020 12:00 SAST')).toBeInTheDocument()
    expect(screen.queryByText(/Valid until/)).not.toBeInTheDocument()
  })

  it('says "Valid until" while the link is still open', async () => {
    const seal: PublicPackSeal = { ...makeView().seal, expires_at: '2999-01-02T10:00:00Z' }
    stubApi({ seal: () => json(200, seal) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('Valid until 02 Jan 2999 12:00 SAST')).toBeInTheDocument()
  })

  it('says a revoked link is revoked, whatever its expiry', async () => {
    stubApi({ seal: () => json(200, { ...makeView().seal, revoked: true, expires_at: '2020-01-02T10:00:00Z' }) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('Revoked by the issuer')).toBeInTheDocument()
  })
})

describe('SealCheck — a check that cannot complete', () => {
  it('keeps the loaded seal on screen when the mirror cannot be reached', async () => {
    const seal = await makeSealedSeal()
    stubApi({ seal: () => json(200, seal), mirror: () => { throw new TypeError('network down') } })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText('Hedera mirror unreachable — try again')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'FP-AUDIT-AP1' })).toBeInTheDocument()
    expect(screen.getByText(seal.pdf_sha256)).toBeInTheDocument()
  })

  it('offers a re-run when not verified, and verifies on the second try', async () => {
    const user = userEvent.setup()
    const seal = await makeSealedSeal()
    let mirrorCalls = 0
    const fetchStub = stubApi({
      seal: () => json(200, seal),
      mirror: () => (mirrorCalls++ === 0 ? json(503, {}) : mirrorMessage(seal.seal!.data_hash)),
    })
    render(<SealCheck packId="pack-1" />)
    const rerun = await screen.findByRole('button', { name: 'Check again' })

    await user.click(rerun)

    expect(await screen.findByText('Seal verified on Hedera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    expect(fetchStub.mock.calls.filter(([url]) => String(url).includes('/audit-packs/seal/'))).toHaveLength(2)
  })

  it('shows a mirror 404 as "no message", not as unreachable', async () => {
    const seal = await makeSealedSeal()
    stubApi({ seal: () => json(200, seal), mirror: () => json(404, {}) })

    render(<SealCheck packId="pack-1" />)

    expect(await screen.findByText(/no message at the sealed position/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })

  it('keeps the seal on screen when a refresh fails, and says so beside it', async () => {
    const user = userEvent.setup()
    const seal = await makeSealedSeal()
    let sealCalls = 0
    stubApi({
      seal: () => (sealCalls++ === 0 ? json(200, seal) : json(429, {})),
      mirror: () => json(503, {}),
    })
    render(<SealCheck packId="pack-1" />)

    await user.click(await screen.findByRole('button', { name: 'Check again' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests — try again shortly.')
    expect(screen.getByRole('heading', { name: 'FP-AUDIT-AP1' })).toBeInTheDocument()
  })

  it('checks the trusted mirror even when the server names another, and gives the PDF check the result', async () => {
    const seal = await makeSealedSeal({}, { mirror_base_url: 'https://evil.example' })
    const fetchStub = stubApi({ seal: () => json(200, seal), mirror: () => mirrorMessage(seal.seal!.data_hash) })

    render(<SealCheck packId="pack-1" />)

    await screen.findByText('Seal verified on Hedera')
    const mirrorCalls = fetchStub.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/v1/topics/'))
    expect(mirrorCalls).toHaveLength(1)
    expect(mirrorCalls[0].startsWith('https://testnet.mirrornode.hedera.com/')).toBe(true)
    const pdfCard = screen.getByText('Is my PDF genuine?').closest('section')!
    await waitFor(() => expect(within(pdfCard).getByText(/Check a PDF copy/)).toBeInTheDocument())
  })
})
