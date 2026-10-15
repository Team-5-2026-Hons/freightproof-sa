import { renderHook } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { useAccessibilityTextSize, ACCESSIBILITY_ROOT_FONT_PX } from '../useAccessibilityTextSize'

afterEach(() => { document.documentElement.style.fontSize = '' })

describe('useAccessibilityTextSize', () => {
  it('test_is_false_at_the_default_text_size', () => {
    document.documentElement.style.fontSize = '17px'

    const { result } = renderHook(() => useAccessibilityTextSize())

    expect(result.current).toBe(false)
  })

  it('test_is_true_from_the_first_accessibility_size_up', () => {
    document.documentElement.style.fontSize = `${ACCESSIBILITY_ROOT_FONT_PX}px`

    const { result } = renderHook(() => useAccessibilityTextSize())

    expect(result.current).toBe(true)
  })
})
