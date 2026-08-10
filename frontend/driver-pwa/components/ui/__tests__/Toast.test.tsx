// frontend/driver-pwa/components/ui/__tests__/Toast.test.tsx
//
// The viewport's anchor is a deliberate product decision, not incidental styling: these
// messages are mostly failures, and at the bottom of the screen they appeared under the
// nav pill and the driver's own thumb. Asserting on the anchoring classes is the only
// observable proof of it in jsdom, which has no layout.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToastViewport, type ToastData } from '../Toast'

function makeToast(overrides: Partial<ToastData> = {}): ToastData {
  return { id: 'toast-1', kind: 'error', title: 'Could not open this trip', ...overrides }
}

describe('ToastViewport', () => {
  it('anchors the stack to the top of the screen, not the bottom', () => {
    const { container } = render(<ToastViewport toasts={[makeToast()]} onDismiss={vi.fn()} />)

    const viewport = container.firstElementChild

    expect(viewport?.className).toContain('top-0')
    expect(viewport?.className).not.toContain('bottom-0')
  })

  it('clears the status bar so the first toast is not drawn behind the notch', () => {
    const { container } = render(<ToastViewport toasts={[makeToast()]} onDismiss={vi.fn()} />)

    expect(container.firstElementChild?.className).toContain('safe-area-inset-top')
  })

  it('gives an error toast the assertive alert role', () => {
    render(<ToastViewport toasts={[makeToast({ kind: 'error' })]} onDismiss={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not open this trip')
  })

  it('leaves non-error toasts as polite status messages', () => {
    render(<ToastViewport toasts={[makeToast({ kind: 'success', title: 'Trip started' })]} onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Trip started')
  })
})
