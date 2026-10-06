import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewFields } from './ReviewFields'
describe('review fields', () => {
  it('orders required outcome and multiline note before optional contact with unique IDs', () => {
    const onNote = vi.fn()
    const props = { note: '', outcome: '' as const, contact: '' as const, onNote, onOutcome: vi.fn(), onContact: vi.fn() }
    render(<><ReviewFields {...props} idPrefix="detail"/><ReviewFields {...props} idPrefix="batch"/></>)
    const notes = screen.getAllByLabelText('Review note (required)')
    expect(notes[0].tagName).toBe('TEXTAREA'); expect(notes[0].id).not.toBe(notes[1].id)
    fireEvent.change(notes[0], {target:{value:'Checked fix\nCompared capture times'}})
    expect(onNote).toHaveBeenCalledWith('Checked fix\nCompared capture times')
    expect(screen.getAllByLabelText('Contact method (optional)')[0]).toHaveValue('')
    const fields = [...document.querySelectorAll('select,textarea')]
    expect(fields.slice(0,3).map(x=>x.tagName)).toEqual(['SELECT','TEXTAREA','SELECT'])
  })
})
