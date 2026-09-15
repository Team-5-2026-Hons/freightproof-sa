import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VerifyButton } from './VerifyButton'

const post = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/client', () => ({ api: { post } }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify }) }))

beforeEach(() => {
  post.mockReset()
  notify.mockReset()
})

afterEach(() => vi.useRealTimers())

it('limits a verified trip claim to committed details and reports check time', async () => {
  post.mockResolvedValue({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: false,
  })
  const onResult = vi.fn()
  render(<VerifyButton subjectType="trip" subjectId="trip" onResult={onResult} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))
  expect(await screen.findByText('Committed trip details match')).toBeInTheDocument()
  expect(screen.getByText(/Photos, scans and other evidence are not covered/)).toBeInTheDocument()
  expect(screen.getByText(/Checked/)).toBeInTheDocument()
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'verified' }), expect.any(String))
})

it('verifies a phase receipt by phase-event subject and describes evidence coverage precisely', async () => {
  const phaseEventId = '11111111-1111-4111-8111-111111111111'
  post.mockResolvedValue({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: true,
  })
  render(<VerifyButton subjectType="phase_event" subjectId={phaseEventId} />)

  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))

  expect(await screen.findByText('Phase receipt matches')).toBeInTheDocument()
  expect(screen.getByText(/linked evidence bytes match their blockchain commitment/)).toBeInTheDocument()
  expect(post).toHaveBeenCalledWith('/api/v1/blockchain/verify', {
    subject_type: 'phase_event',
    subject_id: phaseEventId,
  }, { idempotent: true, timeoutMs: 35_000 })
})

it('does not claim evidence-byte coverage for a verified legacy phase receipt', async () => {
  post.mockResolvedValue({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: false,
  })
  render(<VerifyButton
    subjectType="phase_event"
    subjectId="22222222-2222-4222-8222-222222222222"
    ariaLabel="Verify departure receipt integrity"
  />)

  fireEvent.click(screen.getByRole('button', { name: 'Verify departure receipt integrity' }))

  expect(await screen.findByText(/legacy receipt did not commit evidence bytes/)).toBeInTheDocument()
})

it('describes a Hedera mismatch without blaming off-chain evidence', async () => {
  post.mockResolvedValue({
    status: 'hedera_mismatch', receipt: null,
    expected_hash: 'a', current_hash: null, evidence_verified: false,
  })
  render(<VerifyButton subjectType="phase_event" subjectId="33333333-3333-4333-8333-333333333333" />)

  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))

  expect(await screen.findByText('The Hedera record does not match the expected receipt hash.')).toBeInTheDocument()
  expect(screen.queryByText(/current record or linked evidence/)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'View Mismatch Report' }))
  expect(screen.getByText(/current off-chain record matched its receipt/i)).toBeInTheDocument()
  expect(screen.queryByText('Reconstructed off-chain state')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Re-check' })).toBeInTheDocument()
})

it('keeps phase context, moves focus to the result, and permits manual re-checking', async () => {
  post.mockResolvedValue({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: true,
  })
  render(<VerifyButton
    subjectType="phase_event"
    subjectId="44444444-4444-4444-8444-444444444444"
    ariaLabel="Verify integrity for Departure receipt, phase 3"
  />)

  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity for Departure receipt, phase 3' }))
  const result = await screen.findByRole('status', {
    name: 'Integrity verification for Departure receipt, phase 3',
  })

  await waitFor(() => expect(result).toHaveFocus())
  fireEvent.click(screen.getByRole('button', {
    name: 'Re-check integrity for Departure receipt, phase 3',
  }))
  expect(await screen.findByText('Phase receipt matches')).toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(2)
})

it('does not steal focus when the user moves elsewhere during verification', async () => {
  let resolveRequest!: (result: {
    status: 'verified'; receipt: null; expected_hash: string; current_hash: string;
    evidence_verified: boolean
  }) => void
  post.mockReturnValue(new Promise(resolve => { resolveRequest = resolve }))
  render(<>
    <VerifyButton subjectType="phase_event" subjectId="55555555-5555-4555-8555-555555555555" />
    <button type="button">Elsewhere</button>
  </>)

  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
  elsewhere.focus()
  await act(async () => resolveRequest({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: true,
  }))

  expect(await screen.findByText('Phase receipt matches')).toBeInTheDocument()
  expect(elsewhere).toHaveFocus()
})

it('returns focus after a user starts an auto-mode re-check', async () => {
  post.mockResolvedValue({
    status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a', evidence_verified: true,
  })
  render(<VerifyButton
    autoVerify
    subjectType="phase_event"
    subjectId="66666666-6666-4666-8666-666666666666"
    ariaLabel="Verify integrity for Delivery receipt, phase 6"
  />)

  const recheck = await screen.findByRole('button', {
    name: 'Re-check integrity for Delivery receipt, phase 6',
  })
  recheck.focus()
  fireEvent.click(recheck)

  await waitFor(() => {
    expect(post).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status', {
      name: 'Integrity verification for Delivery receipt, phase 6',
    })).toHaveFocus()
  })
})

it('uses neutral wording when verification cannot be completed', async () => {
  post.mockResolvedValue({
    status: 'error', receipt: null, expected_hash: null, current_hash: null, evidence_verified: false,
  })
  render(<VerifyButton subjectType="phase_event" subjectId="55555555-5555-4555-8555-555555555555" />)

  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))

  expect(await screen.findByText('Verification could not be completed')).toBeInTheDocument()
  expect(screen.getByText(/Review the receipt or try again later/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Re-check' })).toBeInTheDocument()
})

it('resets a manual result without stealing focus from another control', async () => {
  vi.useFakeTimers()
  post.mockResolvedValue({ status: 'verified', evidence_verified: true, receipt: null })
  render(<><VerifyButton subjectType="phase_event" subjectId="phase" /><button>Elsewhere</button></>)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' })))
  screen.getByRole('button', { name: 'Elsewhere' }).focus()

  await act(async () => vi.advanceTimersByTime(8000))

  expect(screen.getByRole('button', { name: 'Verify integrity' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
})

it('keeps an open mismatch report past the reset and can verify again after closing', async () => {
  vi.useFakeTimers()
  post.mockResolvedValue({ status: 'db_mismatch', evidence_verified: false, receipt: null })
  render(<VerifyButton subjectType="phase_event" subjectId="phase" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' })))
  fireEvent.click(screen.getByRole('button', { name: 'View Mismatch Report' }))
  await act(async () => vi.advanceTimersByTime(9000))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Re-check' })))
  expect(post).toHaveBeenCalledTimes(2)
})

it('ignores responses for a previous subject and after unmount', async () => {
  let finish!: (value: unknown) => void
  post.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onResult = vi.fn()
  const { rerender, unmount } = render(<VerifyButton subjectType="phase_event" subjectId="old" onResult={onResult} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))
  rerender(<VerifyButton subjectType="phase_event" subjectId="new" onResult={onResult} />)
  await act(async () => finish({ status: 'verified', evidence_verified: true }))
  expect(onResult).not.toHaveBeenCalled()

  fireEvent.click(await screen.findByRole('button', { name: 'Verify integrity' }))
  unmount()
  await act(async () => finish({ status: 'verified', evidence_verified: true }))
  expect(onResult).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})
