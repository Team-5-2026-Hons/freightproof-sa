import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { InfoPopover } from './InfoPopover'

describe('InfoPopover label', () => {
  it('labels the button and the panel "About this chart: {title}" by default, as every chart relies on', async () => {
    const user = userEvent.setup()
    render(<InfoPopover title="Trips by day" question="Are we getting busier?" />)

    const button = screen.getByRole('button', { name: 'About this chart: Trips by day' })
    await user.click(button)

    expect(screen.getByRole('region', { name: 'About this chart: Trips by day' })).toHaveTextContent('Are we getting busier?')
  })
  it('uses ariaLabel for both the button and the panel when one is given', async () => {
    const user = userEvent.setup()
    render(<InfoPopover title="Parcel record" ariaLabel="How to read this parcel record" question="How to read this parcel record" />)

    const button = screen.getByRole('button', { name: 'How to read this parcel record' })
    await user.click(button)

    expect(screen.queryByRole('button', { name: /About this chart/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'How to read this parcel record' })).toBeInTheDocument()
  })
})
