import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ManifestPreviewState } from '@/lib/hooks/useManifestPreview'
import { ManifestLookup, type ManifestLookupProps } from './ManifestLookup'

function renderLookup(state: ManifestPreviewState, overrides: Partial<ManifestLookupProps> = {}): ManifestLookupProps {
  const props: ManifestLookupProps = {
    value: '81', onChange: vi.fn(), onLookUp: vi.fn(), state, inputError: null, onEmptyLeg: vi.fn(), ...overrides,
  }
  render(<ManifestLookup {...props} />)
  return props
}

describe('ManifestLookup', () => {
  it('looks up on Enter and on the button', () => {
    const props = renderLookup({ status: 'idle' })

    fireEvent.keyDown(screen.getByLabelText(/Manifest number/), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))

    expect(props.onLookUp).toHaveBeenCalledTimes(2)
  })

  it('reports typing to the page', () => {
    const props = renderLookup({ status: 'idle' })

    fireEvent.change(screen.getByLabelText(/Manifest number/), { target: { value: '82' } })

    expect(props.onChange).toHaveBeenCalledWith('82')
  })

  it('offers an empty leg when the parcel system has no manifest lookup', () => {
    const message = 'Manifest lookup is not available from the connected parcel system.'
    const props = renderLookup({ status: 'failed', manifestNumber: 81, failure: { kind: 'unsupported', message } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: 'Create an empty leg instead' }))
    expect(props.onEmptyLeg).toHaveBeenCalled()
  })

  it('offers a retry when the parcel system is unreachable', () => {
    const props = renderLookup({
      status: 'failed', manifestNumber: 81, failure: { kind: 'retryable', message: 'The parcel system is unreachable. Try again shortly.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(props.onLookUp).toHaveBeenCalled()
  })

  it('shows an input error under the field and marks it invalid', () => {
    renderLookup({ status: 'idle' }, { value: 'JNB', inputError: 'Enter the manifest number using digits only, e.g. 81.' })

    expect(screen.getByRole('alert')).toHaveTextContent('digits only')
    expect(screen.getByLabelText(/Manifest number/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('announces a lookup in progress', () => {
    renderLookup({ status: 'loading', manifestNumber: 81 })

    expect(screen.getByRole('status')).toHaveTextContent('Looking up manifest 81')
  })
})
