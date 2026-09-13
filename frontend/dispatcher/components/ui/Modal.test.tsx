import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Modal } from './Modal'

it('names the dialog, returns focus and guards Escape during submission', () => {
  const close = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const { rerender, unmount } = render(<Modal open title="Review evidence" onClose={close}><button>Inspect</button></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Review evidence' })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(1)
  rerender(<Modal open title="Review evidence" onClose={close} closeDisabled><button>Inspect</button></Modal>)
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled()
  unmount()
  expect(trigger).toHaveFocus()
  trigger.remove()
})

it('applies max-w-6xl for the xl size', () => {
  render(<Modal open title="Wide review" onClose={() => {}} size="xl"><p>Content</p></Modal>)
  expect(screen.getByRole('dialog', { name: 'Wide review' })).toHaveClass('max-w-6xl')
})
