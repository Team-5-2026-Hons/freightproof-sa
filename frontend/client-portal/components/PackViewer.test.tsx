import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import { sha256Hex } from '@/lib/verify'
import {
  makeAnchoredRecord, makeException, makeInvestigation, makeManifest, makePhase, makeSealedSeal, makeView,
} from '@/test/factories'
import { PackViewer } from './PackViewer'

vi.mock('next/dynamic', () => ({ default: () => () => null }))

const fetchPack = vi.fn()
const verifyPassword = vi.fn()
const storageBlocked = vi.fn(() => false)
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchPack: (token: string) => fetchPack(token),
  verifyPassword: (token: string, password: string) => verifyPassword(token, password),
  storageBlocked: () => storageBlocked(),
}))

beforeEach(() => {
  fetchPack.mockReset()
  verifyPassword.mockReset()
  storageBlocked.mockReset()
  storageBlocked.mockReturnValue(false)
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** matchMedia that reports a match only for queries containing one of the fragments. */
function stubMatchMedia(matching: string[]) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.some((fragment) => query.includes(fragment)), media: query, addEventListener: () => undefined,
    removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined,
    onchange: null, dispatchEvent: () => false,
  }))
}

describe('PackViewer', () => {
  it('shows the pack, its recipient and the observations', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest({
      observations: [{ code: 'seal.continuity', level: 'info', text: 'Seal SEAL-001 applied at departure matched.', evidence_ids: [] }],
    })))

    render(<PackViewer token="tok" />)

    expect(await screen.findByRole('heading', { name: 'Trip FP-AUDIT', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('FP-AUDIT-AP1')).toBeInTheDocument()
    expect(screen.getByText(/issued to Jane Adjuster, Santam Claims/)).toBeInTheDocument()
    expect(screen.getByText('Seal SEAL-001 applied at departure matched.')).toBeInTheDocument()
    expect(fetchPack).toHaveBeenCalledWith('tok')
  })

  it('explains a revoked or expired link', async () => {
    fetchPack.mockRejectedValue(new PackError(410, 'This audit pack link has expired.'))

    render(<PackViewer token="old" />)

    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeInTheDocument()
    expect(screen.getByText('This audit pack link has expired.')).toBeInTheDocument()
  })

  it('shows an event’s detail when it is picked on the timeline', async () => {
    const user = userEvent.setup()
    fetchPack.mockResolvedValue(makeView(makeManifest({
      phases: [makePhase(3, 'departure', { seal_number: 'SEAL-001', tier: 'anchored' })],
      exceptions: [makeException('panic_button', 'critical', { description: 'Panic held' })],
    })))
    render(<PackViewer token="tok" />)
    const timeline = await screen.findByRole('list', { name: 'Trip timeline' })

    await user.click(within(timeline).getByRole('button', { name: /P3 · Departure/ }))

    expect(screen.getByText('SEAL-001')).toBeInTheDocument()
    await waitFor(() => expect(within(timeline).getByRole('button', { name: /P3 · Departure/ })).toHaveAttribute('aria-current', 'true'))
  })
})

describe('PackViewer incident', () => {
  it('shows declared police facts under the Declared tier and offers the fact sheet', async () => {
    const panic = makeException('panic_button', 'critical', { description: 'Panic held' })
    fetchPack.mockResolvedValue(makeView(makeManifest({
      exceptions: [panic],
      incident: {
        exception_ids: [panic.exception_id], first_exception_type: 'panic_button', first_raised_at: panic.raised_at,
        position: null, last_known_position: null, first_reviewed_at: null, minutes_to_first_review: null,
      },
      declarations: [{
        declaration_id: 'd-1', exception_id: null, saps_station: 'Harrismith SAPS', saps_cas_number: '123/09/2026',
        saps_officer: null, reported_to_saps_at: '2026-09-12T11:40:00Z', tracking_company_notified_at: null,
        insurer_notified_at: null, client_notified_at: null, insurer_claim_reference: null, note: null,
        declared_by_name: 'Ops Desk', declared_at: '2026-09-13T06:00:00Z', tier: 'declared',
      }],
    })))

    render(<PackViewer token="tok" />)

    const incident = await screen.findByRole('region', { name: 'Incident summary' })
    expect(within(incident).getByText(/123\/09\/2026/)).toBeInTheDocument()
    expect(within(incident).getByText(/Harrismith SAPS/)).toBeInTheDocument()
    expect(within(incident).getAllByText('Declared').length).toBeGreaterThan(0)
    expect(within(incident).getByRole('button', { name: 'Download incident fact sheet' })).toBeInTheDocument()
  })
})

describe('PackViewer mailed password (FP-291)', () => {
  it('asks for the mailed password instead of showing an error, then opens the pack', async () => {
    const user = userEvent.setup()
    fetchPack
      .mockRejectedValueOnce(new PackError(401, 'Enter the mailed password to open this pack.', 'j***@santam.example'))
      .mockResolvedValueOnce(makeView(makeManifest()))
    verifyPassword.mockResolvedValue(undefined)
    render(<PackViewer token="tok" />)
    expect(await screen.findByRole('heading', { name: "Confirm it's you" })).toBeInTheDocument()
    expect(screen.getByText('j***@santam.example')).toBeInTheDocument()

    await user.type(await screen.findByLabelText('Password'), 's3cretPass')
    await user.click(screen.getByRole('button', { name: 'Open pack' }))

    expect(verifyPassword).toHaveBeenCalledWith('tok', 's3cretPass')
    expect(await screen.findByRole('heading', { name: 'Trip FP-AUDIT', level: 1 })).toBeInTheDocument()
    expect(fetchPack).toHaveBeenCalledTimes(2)
  })
})

describe('PackViewer — load failures', () => {
  it.each([[0, 'a network error'], [503, 'a server error'], [429, 'rate limiting']])(
    'offers "Try again" after %i (%s), and loads the pack when it works',
    async (status) => {
      const user = userEvent.setup()
      fetchPack
        .mockRejectedValueOnce(status === 0 ? new TypeError('network down') : new PackError(status, 'Try again shortly.'))
        .mockResolvedValueOnce(makeView(makeManifest()))
      render(<PackViewer token="tok" />)

      await user.click(await screen.findByRole('button', { name: 'Try again' }))

      expect(await screen.findByRole('heading', { name: 'Trip FP-AUDIT', level: 1 })).toBeInTheDocument()
      expect(fetchPack).toHaveBeenCalledTimes(2)
    },
  )

  it.each([[410], [404]])('offers no retry for %i, where trying again cannot help', async (status) => {
    fetchPack.mockRejectedValue(new PackError(status, 'Gone.'))

    render(<PackViewer token="tok" />)

    await screen.findByText('Gone.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('PackViewer — seal and PDF check', () => {
  async function sealedView() {
    const records = [await makeAnchoredRecord(1)]
    const seal = await makeSealedSeal()
    return { records, seal, view: { ...makeView(makeManifest({ anchored_records: records })), seal } }
  }

  /** The seal's own PDF fingerprint is the SHA-256 of this text, so uploading it matches the sealed hash. */
  async function sealedForPdf(pdfText: string) {
    const seal = await makeSealedSeal({ pdf_sha256: await sha256Hex(pdfText) })
    return { ...makeView(makeManifest()), seal }
  }

  function mirror(answer: (url: string) => Response) {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => answer(String(input))))
  }

  it('says the pack was not sealed instead of showing a green banner, when it carries no seal', async () => {
    const record = await makeAnchoredRecord(1)
    mirror(() => new Response(JSON.stringify({ message: btoa(record.data_hash) }), { status: 200 }))
    fetchPack.mockResolvedValue(makeView(makeManifest({ anchored_records: [record] })))

    render(<PackViewer token="tok" />)

    expect(await screen.findByText('Pack not sealed · 1 of 1 record verified in your browser')).toBeInTheDocument()
    expect(screen.getByText('Pack seal · FP-AUDIT-AP1').closest('section')).not.toHaveClass('border-ok')
  })

  it('goes green only for a verified seal with verified records', async () => {
    const { view, seal, records } = await sealedView()
    mirror((url) => {
      const sequence = Number(url.split('/').pop())
      const hash = sequence === 900 ? seal.seal!.data_hash : records[0].data_hash
      return new Response(JSON.stringify({ message: btoa(hash) }), { status: 200 })
    })
    fetchPack.mockResolvedValue(view)

    render(<PackViewer token="tok" />)

    expect(await screen.findByText('Seal verified · 1 of 1 record verified in your browser')).toBeInTheDocument()
    expect(screen.getByText('Pack seal · FP-AUDIT-AP1').closest('section')).toHaveClass('border-ok')
  })

  it('passes the seal result to the PDF check: a matching PDF is "unaltered" only once the seal is verified', async () => {
    const user = userEvent.setup()
    const view = await sealedForPdf('%PDF-issued')
    mirror(() => new Response(JSON.stringify({ message: btoa(view.seal.seal!.data_hash) }), { status: 200 }))
    fetchPack.mockResolvedValue(view)
    render(<PackViewer token="tok" />)
    await screen.findByText(/Seal verified/)

    await user.upload(screen.getByLabelText(/Check a PDF copy/), new File(['%PDF-issued'], 'pack.pdf', { type: 'application/pdf' }))

    expect(await screen.findByText(/pack\.pdf is an unaltered copy of pack FP-AUDIT-AP1 \(seal verified on Hedera\)/)).toBeInTheDocument()
  })

  it('…and says the seal is not confirmed when Hedera could not be reached', async () => {
    const user = userEvent.setup()
    const view = await sealedForPdf('%PDF-issued')
    mirror(() => new Response('busy', { status: 503 }))
    fetchPack.mockResolvedValue(view)
    render(<PackViewer token="tok" />)
    await screen.findByText(/Seal not confirmed/)

    await user.upload(screen.getByLabelText(/Check a PDF copy/), new File(['%PDF-issued'], 'pack.pdf', { type: 'application/pdf' }))

    const result = await screen.findByText(/but the seal itself is not confirmed/)
    expect(result).toHaveClass('text-warn')
    expect(result).not.toHaveTextContent('unaltered copy')
  })
})

describe('PackViewer — layout behaviour', () => {
  const pickEvent = async () => {
    const user = userEvent.setup()
    fetchPack.mockResolvedValue(makeView(makeManifest({ exceptions: [makeException('panic_button', 'critical')] })))
    render(<PackViewer token="tok" />)
    const timeline = await screen.findByRole('list', { name: 'Trip timeline' })
    await user.click(within(timeline).getByRole('button', { name: /Panic button/ }))
  }

  it('scrolls to the Evidence card on a small screen, smoothly', async () => {
    stubMatchMedia(['max-width: 1279px'])

    await pickEvent()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls without animation when the reader prefers reduced motion', async () => {
    stubMatchMedia(['max-width: 1279px', 'prefers-reduced-motion'])

    await pickEvent()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('does not scroll on a wide screen, where the Evidence card is already beside the timeline', async () => {
    stubMatchMedia([])

    await pickEvent()

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: /E1 · Panic button/ })).toBeInTheDocument()
  })

  it('makes the right-hand column sticky and the timeline scrollable on wide screens only', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest()))

    render(<PackViewer token="tok" />)

    const route = (await screen.findByRole('region', { name: 'Route' })).parentElement!
    expect(route).toHaveClass('lg:sticky', 'lg:top-4', 'lg:self-start')
    const timelineBody = screen.getByRole('list', { name: 'Trip timeline' }).parentElement!
    expect(timelineBody).toHaveClass('lg:max-h-[70vh]', 'lg:overflow-y-auto', 'print:max-h-none')
  })
})

describe('PackViewer — sections', () => {
  it('numbers its six sections the way the PDF does and lists them in the contents', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest()))

    render(<PackViewer token="tok" />)

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '#ch-summary', '#ch-journey', '#ch-exceptions', '#ch-details', '#ch-verification', '#ch-data-protection',
    ])
    for (const title of ['Summary and findings', 'Journey and custody', 'Exceptions and response', 'Verification']) {
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument()
    }
    expect(links[0]).toHaveAttribute('aria-current', 'location')
  })
})

describe('PackViewer — notices', () => {
  it('tells the reader when the browser blocks site storage', async () => {
    storageBlocked.mockReturnValue(true)
    fetchPack.mockResolvedValue(makeView(makeManifest()))

    render(<PackViewer token="tok" />)

    expect(await screen.findByText('This browser blocks site storage, so you may be asked for a code again next time.')).toBeInTheDocument()
  })

  it('says nothing about storage otherwise', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest()))

    render(<PackViewer token="tok" />)

    await screen.findByRole('heading', { name: 'Trip FP-AUDIT', level: 1 })
    expect(screen.queryByText(/blocks site storage/)).not.toBeInTheDocument()
  })

  it('shows investigations in the exceptions section instead of only counting them', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest({ investigations: [makeInvestigation({ summary: 'Reported by phone' })] })))

    render(<PackViewer token="tok" />)

    const section = await screen.findByRole('region', { name: 'Exceptions and response' })
    expect(within(section).getByRole('region', { name: 'Investigations' })).toHaveTextContent('Reported by phone')
    expect(screen.queryByRole('region', { name: 'Not shown in this viewer' })).not.toBeInTheDocument()
  })

  it('gives the PDF download a 44 px tap target', async () => {
    fetchPack.mockResolvedValue(makeView(makeManifest()))

    render(<PackViewer token="tok" />)

    expect(await screen.findByRole('button', { name: 'Download PDF' })).toHaveClass('min-h-11')
  })
})
