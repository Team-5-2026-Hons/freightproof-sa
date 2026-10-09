import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Table, type TableColumn } from './Table'

interface Row { id: string; name: string; city: string }
const ROWS: Row[] = [{ id: '1', name: 'Alice', city: 'Cape Town' }, { id: '2', name: 'Bob', city: 'Durban' }]

const COLUMNS: TableColumn<Row>[] = [
  { id: 'name', label: 'Name', width: 200, sortable: true, render: row => row.name },
  { id: 'city', label: 'City', width: 200, render: row => row.city },
  { id: 'extra', label: 'Extra', width: 200, hideBelow: 900, render: () => 'extra-cell' },
]

let containerWidth = 0
beforeEach(() => {
  localStorage.clear()
  containerWidth = 1200
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth)
})
afterEach(() => { vi.restoreAllMocks() })

function renderTable(props: Partial<React.ComponentProps<typeof Table<Row>>> = {}) {
  return render(<Table<Row> tableId="t" caption="People" columns={COLUMNS} rows={ROWS} getRowKey={row => row.id} {...props} />)
}

describe('Table', () => {
  it('renders a captioned table with one row per item and a cell per visible column', () => {
    renderTable()
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
    expect(screen.getAllByRole('row')).toHaveLength(1 + ROWS.length)
    expect(screen.getByText('Cape Town')).toBeInTheDocument()
  })

  it('makes only sortable headers buttons and reports the clicked column', () => {
    const onSort = vi.fn()
    renderTable({ onSort })
    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'City' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSort).toHaveBeenCalledWith('name')
  })

  it('exposes the sort direction on the sorted header only', () => {
    renderTable({ onSort: vi.fn(), sort: { id: 'name', dir: 'desc' } })
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: /City/ })).not.toHaveAttribute('aria-sort')
  })

  it('is not sortable without an onSort handler, even if a column asks for it', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: 'Name' })).toBeNull()
  })

  it('hides a column on a narrow container and tells cells which are hidden', () => {
    containerWidth = 600
    const render = vi.fn((row: Row, context: { hidden: ReadonlySet<string> }) => `${row.name}${context.hidden.has('extra') ? '·folded' : ''}`)
    renderTable({ columns: [{ ...COLUMNS[0], render }, COLUMNS[1], COLUMNS[2]] })
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.queryByText('extra-cell')).toBeNull()
    expect(screen.getByText('Alice·folded')).toBeInTheDocument()
  })

  it('resizes a column from the keyboard handle', () => {
    renderTable()
    const handle = screen.getByRole('separator', { name: 'Resize City column' })
    const before = Number(handle.getAttribute('aria-valuenow'))
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(Number(screen.getByRole('separator', { name: 'Resize City column' }).getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })

  it('renders groups with their header, and hides a collapsed group body', () => {
    const header = vi.fn((bodyId: string) => <button type="button" aria-controls={bodyId}>Group A</button>)
    renderTable({
      rows: undefined,
      groups: [{ id: 'a', header, rows: [ROWS[0]] }, { id: 'b', header: () => <span>Group B</span>, rows: [ROWS[1]], collapsed: true }],
    })
    const controlled = screen.getByRole('button', { name: 'Group A' }).getAttribute('aria-controls')
    expect(controlled).toBe('t-group-a')
    expect(document.getElementById('t-group-b')).toHaveAttribute('hidden')
    expect(within(document.getElementById('t-group-a') as HTMLElement).getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Group B')).toBeInTheDocument()
  })

  it('applies the caller row class and gives the owner the scroller element', () => {
    const onScroller = vi.fn()
    renderTable({ rowClassName: row => (row.id === '2' ? 'row-flash' : undefined), onScroller })
    expect(screen.getByText('Bob').closest('tr')).toHaveClass('row-flash')
    expect(onScroller).toHaveBeenCalledWith(expect.any(HTMLDivElement))
  })

  describe('while loading', () => {
    it('keeps the real header and shows placeholder rows instead of data', () => {
      renderTable({ isLoading: true })
      expect(screen.getAllByRole('columnheader', { hidden: true })).toHaveLength(3)
      expect(document.querySelectorAll('tbody tr')).toHaveLength(6)
      expect(screen.queryByText('Alice')).toBeNull()
    })

    it('marks the table busy and announces the loading label once, with the placeholders hidden from assistive tech', () => {
      renderTable({ isLoading: true, loadingLabel: 'Loading people' })
      expect(screen.getByRole('table', { name: 'People' })).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('status')).toHaveTextContent('Loading people')
      expect(document.querySelector('tbody')).toHaveAttribute('aria-hidden', 'true')
    })

    it('uses a column\'s own skeleton and a generic bar for columns without one', () => {
      renderTable({
        isLoading: true, skeletonRows: 2,
        columns: [{ ...COLUMNS[0], skeleton: <span data-testid="custom-skeleton" /> }, COLUMNS[1], COLUMNS[2]],
      })
      expect(screen.getAllByTestId('custom-skeleton')).toHaveLength(2)
      // 2 rows x 2 generic cells (City, Extra) each get one bar.
      expect(document.querySelectorAll('tbody .animate-pulse')).toHaveLength(4)
    })

    describe('filling the scroll area', () => {
      const HEADER_HEIGHT = 40
      const ROW_HEIGHT = 50
      let containerHeight = 0

      function height(element: Element): number {
        if (element.tagName === 'THEAD') return HEADER_HEIGHT
        return element.tagName === 'TR' ? ROW_HEIGHT : 0
      }

      beforeEach(() => {
        containerHeight = 490
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => containerHeight)
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
          return { height: height(this) } as DOMRect
        })
        // The shared stub never reports a size; a real observer reports one as soon as it observes.
        vi.stubGlobal('ResizeObserver', class {
          constructor(private readonly callback: () => void) {}
          observe(): void { this.callback() }
          unobserve(): void {}
          disconnect(): void {}
        })
      })
      afterEach(() => { vi.unstubAllGlobals() })

      it('adds placeholder rows until they reach the bottom of the scroll area', () => {
        renderTable({ isLoading: true })

        // (490 - 40 header) / 50 per row = 9 rows, more than the default 6.
        expect(document.querySelectorAll('tbody tr')).toHaveLength(9)
      })

      it('rounds up so the last placeholder row runs off the bottom edge', () => {
        containerHeight = 500

        renderTable({ isLoading: true })

        expect(document.querySelectorAll('tbody tr')).toHaveLength(10)
      })

      it('never shows fewer rows than skeletonRows asks for', () => {
        containerHeight = 100

        renderTable({ isLoading: true, skeletonRows: 6 })

        expect(document.querySelectorAll('tbody tr')).toHaveLength(6)
      })

      it('clips rather than scrolls while loading, so the filler never adds a scrollbar', () => {
        const { container } = renderTable({ isLoading: true })

        expect(container.firstElementChild).toHaveClass('overflow-hidden')
        expect(container.firstElementChild).not.toHaveClass('overflow-auto')
      })
    })

    it('shows rows, not busy, and an empty status once loading ends', () => {
      renderTable({ isLoading: false })
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByRole('table', { name: 'People' })).toHaveAttribute('aria-busy', 'false')
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('still lets the owner sort the real headers while loading', () => {
      const onSort = vi.fn()
      renderTable({ isLoading: true, onSort })
      fireEvent.click(screen.getByRole('button', { name: 'Name' }))
      expect(onSort).toHaveBeenCalledWith('name')
    })
  })

  it('puts a divider between neighbouring columns in the header and every row, never before the first', () => {
    renderTable()
    const DIVIDER = '[&:not(:first-child)]:border-l'
    const header = screen.getAllByRole('columnheader')
    const cells = within(screen.getByText('Alice').closest('tr') as HTMLElement).getAllByRole('cell')
    for (const cell of [...header, ...cells]) expect(cell.className).toContain(DIVIDER)
    // The :not(:first-child) variant is what keeps the first cell's edge clear; assert it is the
    // variant that is used rather than a bare border-l.
    expect(header[0].className).not.toMatch(/(^|\s)border-l(\s|$)/)
  })

  it('does not divide a group header, which is one full-width cell', () => {
    renderTable({ rows: undefined, groups: [{ id: 'g', header: () => 'Group A', rows: ROWS }] })
    const groupCell = screen.getByText('Group A').closest('td') as HTMLElement
    expect(groupCell.className).not.toContain('border-l')
  })

  it('is comfortable by default and tightens rows and header when compact', () => {
    const { unmount } = renderTable()
    expect(screen.getByText('Alice').closest('td')).toHaveClass('px-4', 'py-4', 'align-top')
    expect(screen.getAllByRole('columnheader')[0]).toHaveClass('py-[10px]')
    unmount()

    renderTable({ density: 'compact' })
    expect(screen.getByText('Alice').closest('td')).toHaveClass('px-3', 'py-3', 'align-middle')
    expect(screen.getAllByRole('columnheader')[0]).toHaveClass('py-[7px]')
  })
})
