import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RequirementChips } from '../RequirementChips'

describe('RequirementChips', () => {
  it('test_lists_each_requirement_with_its_state_spoken', () => {
    render(
      <RequirementChips
        requirements={[
          { label: 'Seal number', met: true },
          { label: 'Seal photo', met: false },
        ]}
      />,
    )

    const items = within(screen.getByRole('list', { name: 'Needed to continue' })).getAllByRole('listitem')

    expect(items[0]).toHaveTextContent('Done: Seal number')
    expect(items[1]).toHaveTextContent('Still needed: Seal photo')
  })

  it('test_met_chips_are_success_tinted_and_unmet_are_grey', () => {
    render(
      <RequirementChips
        requirements={[
          { label: 'Seal number', met: true },
          { label: 'Seal photo', met: false },
        ]}
      />,
    )

    const [met, unmet] = screen.getAllByRole('listitem')

    expect(met).toHaveClass('bg-success-tint')
    expect(unmet).toHaveClass('bg-fill')
  })

  it('test_renders_nothing_for_an_empty_list', () => {
    const { container } = render(<RequirementChips requirements={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
