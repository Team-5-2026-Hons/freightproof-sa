import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ListRow, ListSection } from '../ListSection'

describe('ListSection', () => {
  it('test_renders_a_heading_when_titled', () => {
    render(
      <ListSection title="Preferences">
        <ListRow value="Appearance" />
      </ListSection>,
    )

    expect(screen.getByRole('heading', { name: 'Preferences', level: 2 })).toBeInTheDocument()
  })

  it('test_puts_one_inset_rule_between_rows_and_none_after_the_last', () => {
    const { container } = render(
      <ListSection>
        <ListRow value="Location" />
        <ListRow value="Camera" />
        <ListRow value="Waiting to send" />
      </ListSection>,
    )

    expect(container.querySelectorAll('[data-list-rule]')).toHaveLength(2)
  })

  it('test_skips_rows_that_render_nothing', () => {
    const hasPhone = false
    const { container } = render(
      <ListSection>
        <ListRow value="Email support" />
        {hasPhone && <ListRow value="Call dispatch" />}
      </ListSection>,
    )

    expect(container.querySelectorAll('[data-list-rule]')).toHaveLength(0)
  })
})

describe('ListRow', () => {
  it('test_shows_the_label_above_the_value', () => {
    render(<ListRow label="Seal" value="AB-4471" />)

    const label = screen.getByText('Seal')
    const value = screen.getByText('AB-4471')

    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('test_is_a_link_when_given_an_href', () => {
    render(<ListRow value="Appearance" href="/profile" />)

    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute('href', '/profile')
  })

  it('test_external_hrefs_are_plain_anchors', () => {
    render(<ListRow value="Email support" href="mailto:support@freightproof.co.za" />)

    const link = screen.getByRole('link', { name: /Email support/ })

    expect(link).toHaveAttribute('href', 'mailto:support@freightproof.co.za')
    expect(link.tagName).toBe('A')
  })

  it('test_is_a_button_when_given_onClick', () => {
    const onClick = vi.fn()
    render(<ListRow value="GP 12-34 ZX" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: /GP 12-34 ZX/ }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('test_is_inert_without_href_or_onClick', () => {
    render(<ListRow value="Version 0.1.0" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('test_meets_the_touch_target_minimum', () => {
    render(<ListRow value="Appearance" href="/profile" />)

    expect(screen.getByRole('link')).toHaveClass('min-h-[56px]')
  })
})
