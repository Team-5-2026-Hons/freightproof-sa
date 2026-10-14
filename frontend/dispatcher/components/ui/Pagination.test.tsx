import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Pagination, type PaginationProps } from './Pagination'

function makeProps(overrides: Partial<PaginationProps> = {}): PaginationProps {
  return {
    page: 1,
    pageSize: 25,
    itemCount: 25,
    totalItems: 137,
    hasPrevious: false,
    hasNext: true,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  }
}

describe('Pagination', () => {
  it('renders the visible item range against the total', () => {
    render(<Pagination {...makeProps()} />)

    expect(screen.getByText('1–25 of 137')).toBeInTheDocument()
  })

  it('renders the visible item range for a later page from itemCount, not pageSize', () => {
    // Page 6 of a 137-item set at 25/page has only 12 items on it (137 - 125) —
    // the range end must reflect that, not a full page's worth.
    render(
      <Pagination
        {...makeProps({ page: 6, itemCount: 12, hasPrevious: true, hasNext: false })}
      />,
    )

    expect(screen.getByText('126–137 of 137')).toBeInTheDocument()
  })

  it('renders the current page label', () => {
    render(<Pagination {...makeProps({ page: 3 })} />)

    expect(screen.getByText('Page 3')).toBeInTheDocument()
  })

  it('degrades the range sensibly when there are zero results', () => {
    render(
      <Pagination
        {...makeProps({ itemCount: 0, totalItems: 0, hasPrevious: false, hasNext: false })}
      />,
    )

    expect(screen.getByText('0 of 0')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^1/)).not.toBeInTheDocument()
  })

  it('calls onPrevious when the previous button is clicked', () => {
    const onPrevious = vi.fn()
    render(<Pagination {...makeProps({ page: 2, hasPrevious: true, onPrevious })} />)

    fireEvent.click(screen.getByLabelText('Previous page'))

    expect(onPrevious).toHaveBeenCalledTimes(1)
  })

  it('calls onNext when the next button is clicked', () => {
    const onNext = vi.fn()
    render(<Pagination {...makeProps({ hasNext: true, onNext })} />)

    fireEvent.click(screen.getByLabelText('Next page'))

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('disables the previous button on the first page', () => {
    render(<Pagination {...makeProps({ page: 1, hasPrevious: false })} />)

    expect(screen.getByLabelText('Previous page')).toBeDisabled()
  })

  it('disables the next button on the last page', () => {
    render(<Pagination {...makeProps({ page: 6, hasNext: false })} />)

    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('enables both buttons on a middle page', () => {
    render(<Pagination {...makeProps({ page: 3, hasPrevious: true, hasNext: true })} />)

    expect(screen.getByLabelText('Previous page')).not.toBeDisabled()
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('disables both buttons while loading, even mid-list', () => {
    render(
      <Pagination {...makeProps({ page: 3, hasPrevious: true, hasNext: true, isLoading: true })} />,
    )

    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('does not fire callbacks when disabled buttons are clicked', () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    render(
      <Pagination
        {...makeProps({ page: 1, hasPrevious: false, hasNext: false, onPrevious, onNext })}
      />,
    )

    fireEvent.click(screen.getByLabelText('Previous page'))
    fireEvent.click(screen.getByLabelText('Next page'))

    expect(onPrevious).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })
})
