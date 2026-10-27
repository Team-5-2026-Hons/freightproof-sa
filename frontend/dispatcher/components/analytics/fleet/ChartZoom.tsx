'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { ZoomIn } from 'lucide-react'

import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { FLEET_COPY } from './copy'

const COPY = FLEET_COPY.chart

const ZOOM_VIEWPORT_SHARE = 0.8
const ZOOM_CHROME_PX = 190
const ZOOM_MIN_HEIGHT = 320
const ZOOM_ICON_SIZE = 16

interface ChartZoomState {
  height: number
}

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
  title: string
  children: ReactNode
}

/** The one zoom control every analytics chart shares: a zoom-in button that opens the
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
        onClick={() => setZoom({ height: zoomChartHeight(window.innerHeight) })}
      />
      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={title} size="zoom" backdrop="blur">
        <ChartZoomContext.Provider value={zoom}>{children}</ChartZoomContext.Provider>
      </Modal>
    </>
  )
}
