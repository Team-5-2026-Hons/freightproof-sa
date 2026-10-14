import { render } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { TextSizeCap, MAX_ROOT_FONT_PX } from '../TextSizeCap'

// Stands in for the iOS Text Size setting, which reaches the root through a stylesheet.
function setSystemTextSize(px: number) {
  const style = document.createElement('style')
  style.setAttribute('data-test-text-size', '')
  style.textContent = `html { font-size: ${px}px }`
  document.head.appendChild(style)
}

afterEach(() => {
  document.querySelectorAll('[data-test-text-size]').forEach((el) => el.remove())
  document.documentElement.style.removeProperty('font-size')
})

describe('TextSizeCap', () => {
  it('test_leaves_a_text_size_the_layout_carries_alone', () => {
    setSystemTextSize(23)

    render(<TextSizeCap />)

    expect(document.documentElement.style.fontSize).toBe('')
  })

  it('test_holds_the_largest_sizes_at_the_cap', () => {
    setSystemTextSize(53)

    render(<TextSizeCap />)

    expect(document.documentElement.style.fontSize).toBe(`${MAX_ROOT_FONT_PX}px`)
  })

  it('test_lets_go_again_when_the_setting_comes_back_down', () => {
    setSystemTextSize(53)
    render(<TextSizeCap />)
    document.querySelectorAll('[data-test-text-size]').forEach((el) => el.remove())
    setSystemTextSize(23)

    window.dispatchEvent(new Event('resize'))

    expect(document.documentElement.style.fontSize).toBe('')
  })
})
