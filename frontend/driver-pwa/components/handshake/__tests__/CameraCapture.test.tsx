// frontend/driver-pwa/components/handshake/__tests__/CameraCapture.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CameraCapture } from '../CameraCapture'

// Task 2c: the captured photo must read as a framed control, not merge with the page. The image
// sits in a fixed aspect-video frame and fills it via object-cover (no free-height max-h-48).

const SAMPLE_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

describe('CameraCapture captured branch', () => {
  it('renders the image with object-cover inside an aspect-video frame', () => {
    render(<CameraCapture label="Exit gate photo" dataUrl={SAMPLE_DATA_URL} onCapture={vi.fn()} />)

    const img = screen.getByAltText('Exit gate photo')

    expect(img.className).toContain('object-cover')
    expect(img.className).not.toContain('max-h-48')
    expect(img.closest('.aspect-video')).not.toBeNull()
  })
})
