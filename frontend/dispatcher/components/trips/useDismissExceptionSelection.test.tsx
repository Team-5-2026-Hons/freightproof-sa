import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { exceptionRowId } from '@/components/domain/ExceptionRow'
import { KEEP_EXCEPTION_SELECTION_ATTR, useDismissExceptionSelection } from './useDismissExceptionSelection'

const SELECTED_ID = 'selected-exception'
const OTHER_ID = 'other-exception'

function Harness({ selectedId, onDismiss }: { selectedId: string | null; onDismiss: () => void }) {
  useDismissExceptionSelection(selectedId, onDismiss)
  return <div>
    <p>blank space</p>
    <div data-exception-id={SELECTED_ID}><span>selected card</span></div>
    <div data-exception-id={OTHER_ID}><span>other card</span></div>
    <button type="button" id={exceptionRowId(OTHER_ID)}>other timeline row</button>
    <button type="button" {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: '' }}>expand timeline</button>
  </div>
}

describe('useDismissExceptionSelection', () => {
  it('dismisses when the reader clicks elsewhere', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('blank space'))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps the selection when the click lands inside the selected record', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('selected card'))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('leaves another timeline row to select its own record', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('other timeline row'))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('keeps the selection when a layout control marked to keep it is used', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('expand timeline'))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing without a selection', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={null} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('blank space'))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('calls the latest callback without re-binding the listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const { rerender } = render(<Harness selectedId={SELECTED_ID} onDismiss={first} />)
    const bindsAfterMount = addSpy.mock.calls.filter(([type]) => type === 'click').length

    rerender(<Harness selectedId={SELECTED_ID} onDismiss={second} />)
    fireEvent.click(screen.getByText('blank space'))

    expect(addSpy.mock.calls.filter(([type]) => type === 'click')).toHaveLength(bindsAfterMount)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    addSpy.mockRestore()
  })
})
