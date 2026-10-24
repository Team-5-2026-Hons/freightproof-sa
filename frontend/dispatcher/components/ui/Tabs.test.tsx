import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Tabs } from './Tabs'

const TABS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] as const

it('gives every tab an equal share by default', () => {
  render(<Tabs tabs={TABS} active="a" onChange={() => {}} />)

  for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('flex-1')
})

it('sizes tabs to their content when asked, so a long label is not cut to give a short one room', () => {
  render(<Tabs tabs={TABS} active="a" onChange={() => {}} fit="content" />)

  for (const tab of screen.getAllByRole('tab')) {
    expect(tab).toHaveClass('flex-auto')
    expect(tab).not.toHaveClass('flex-1')
  }
})
