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
    <select aria-label="group records"><option>none</option></select>
    <dialog open><button type="button">inside overlay</button></dialog>
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

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.keyDown(screen.getByText('blank space'), { key: 'Escape' })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape to a form field or the open overlay that owns it', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'group records' }), { key: 'Escape' })
    fireEvent.keyDown(screen.getByText('inside overlay'), { key: 'Escape' })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores an Escape another handler has already used', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()

    screen.getByText('blank space').dispatchEvent(event)

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    fireEvent.keyDown(screen.getByText('blank space'), { key: 'Enter' })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('keeps the selection when the click ends a text selection', () => {
    const onDismiss = vi.fn()
    render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)

    fireEvent.click(screen.getByText('blank space'))

    expect(onDismiss).not.toHaveBeenCalled()
    selection.mockRestore()
  })

  it('removes the Escape listener with the selection', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Harness selectedId={SELECTED_ID} onDismiss={onDismiss} />)

    rerender(<Harness selectedId={null} onDismiss={onDismiss} />)
    fireEvent.keyDown(screen.getByText('blank space'), { key: 'Escape' })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('useDismissExceptionSelection: Escape from the panel record', () => {
  function Panel({ withRow, onDismiss }: { withRow: boolean; onDismiss: () => void }) {
    useDismissExceptionSelection(SELECTED_ID, onDismiss)
    return <div>
      <div id="phase-loading"><button type="button" aria-expanded="false">Loading card</button></div>
      {withRow && <button type="button" id={exceptionRowId(SELECTED_ID)}>selected timeline row</button>}
      <div data-exception-id={SELECTED_ID} data-phase-anchor="phase-loading" tabIndex={-1}><button type="button">Review exception</button></div>
      <button type="button">elsewhere</button>
    </div>
  }

  it('returns focus to the timeline row of the record it leaves', () => {
    const onDismiss = vi.fn()
    render(<Panel withRow onDismiss={onDismiss} />)
    screen.getByRole('button', { name: 'Review exception' }).focus()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'selected timeline row' })).toHaveFocus()
  })

  it('falls back to the phase card toggle when the view shows no row', () => {
    render(<Panel withRow={false} onDismiss={vi.fn()} />)
    screen.getByRole('button', { name: 'Review exception' }).focus()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'Loading card' })).toHaveFocus()
  })

  it('leaves focus where it is when Escape comes from outside the record', () => {
    render(<Panel withRow onDismiss={vi.fn()} />)
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    elsewhere.focus()

    fireEvent.keyDown(elsewhere, { key: 'Escape' })

    expect(elsewhere).toHaveFocus()
  })
})
