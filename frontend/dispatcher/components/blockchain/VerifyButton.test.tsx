import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { VerifyButton } from './VerifyButton'

const post = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/client', () => ({ api: { post } }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify }) }))

it('limits a verified trip claim to committed details and reports check time', async () => {
  post.mockResolvedValue({ status: 'verified', receipt: null, expected_hash: 'a', current_hash: 'a' })
  const onResult = vi.fn()
  render(<VerifyButton subjectType="trip" subjectId="trip" onResult={onResult} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }))
  expect(await screen.findByText('Committed trip details match')).toBeInTheDocument()
  expect(screen.getByText(/Photos, scans and other evidence are not covered/)).toBeInTheDocument()
  expect(screen.getByText(/Checked/)).toBeInTheDocument()
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'verified' }), expect.any(String))
})
