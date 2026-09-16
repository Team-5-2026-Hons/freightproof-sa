'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { ZoomIn } from 'lucide-react'

import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { FLEET_COPY } from './copy'

const COPY = FLEET_COPY.chart

// A zoomed chart fills 80% of the viewport's height (the Modal's `zoom` size), less what the
// modal's title bar, padding and the chart's legend take. Below the floor a zoomed chart
// would be no bigger than the card it came from, on a very short window.
const ZOOM_VIEWPORT_SHARE = 0.8
const ZOOM_CHROME_PX = 190
const ZOOM_MIN_HEIGHT = 320
const ZOOM_ICON_SIZE = 16

interface ChartZoomState {
  /** The height, in px, a chart should draw at while zoomed. */
  height: number
}

/** Set only inside the zoom modal. Every chart reads it through useChartHeight, so no chart
 *  needs a zoom prop and a new chart grows in the modal as soon as it uses the hook. */
const ChartZoomContext = createContext<ChartZoomState | null>(null)

/** The height a chart should draw at: its normal height on the card, or the zoomed height
 *  inside the zoom modal. Never smaller than normal, so zooming cannot shrink a tall chart. */
export function useChartHeight(normalHeight: number): number {
  const zoom = useContext(ChartZoomContext)
  return zoom === null ? normalHeight : Math.max(normalHeight, zoom.height)
}

/** Whether the caller is inside the zoom modal, for charts that size by their content (a list
 *  of horizontal bars) rather than by one height. */
export function useIsChartZoomed(): boolean {
  return useContext(ChartZoomContext) !== null
}

/** The zoomed chart height for a viewport this tall. Pure, so it is testable without a window. */
export function zoomChartHeight(viewportHeight: number): number {
  return Math.max(ZOOM_MIN_HEIGHT, Math.round(viewportHeight * ZOOM_VIEWPORT_SHARE) - ZOOM_CHROME_PX)
}

interface ChartZoomProps {
  /** The chart's title: the modal's heading, and what the button's label names. */
  title: string
  /** What the modal shows: the card's current view (chart or table, legend, warnings). */
  children: ReactNode
}

/** The one zoom control every analytics chart shares (D27): a zoom-in button that opens the
 *  chart in a modal at 80% of the page, over a blurred background. It closes on the ×, a click
 *  on the background or Escape (all the Modal's own behaviour). The modal's content renders
 *  only while open, so a closed zoom costs nothing. */
export function ChartZoom({ title, children }: ChartZoomProps) {
  const [zoom, setZoom] = useState<ChartZoomState | null>(null)

  return (
    <>
      <IconButton
        type="button"
        size="sm"
        aria-label={COPY.zoomIn(title)}
        title={COPY.zoomIn(title)}
        icon={<ZoomIn size={ZOOM_ICON_SIZE} aria-hidden />}
        // Measured on open, not on render: the window may have been resized since the page loaded.
        onClick={() => setZoom({ height: zoomChartHeight(window.innerHeight) })}
      />
      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={title} size="zoom" backdrop="blur">
        <ChartZoomContext.Provider value={zoom}>{children}</ChartZoomContext.Provider>
      </Modal>
    </>
  )
}
