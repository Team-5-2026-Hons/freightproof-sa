// frontend/driver-pwa/components/ui/TruckLoader.tsx
//
// The loading indicator for trip-shaped waits: a truck riding over a road that scrolls
// beneath it. Preferred over the generic Spinner wherever the driver is waiting on a
// TRIP to load — a spinner says "busy", a moving truck says "your trip is on its way",
// which is the only thing worth saying on a screen with nothing else on it.
//
// prefers-reduced-motion is handled globally (app/globals.css), which freezes both
// animations and leaves a static truck on a static road — still a legible loading state.
import { Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Truck, road width and dash tile scale together — a full-size dash under a small truck
// reads as a dropped underline rather than a road, so the three are set as one unit.
const sizeMap = {
  sm: { truck: 'h-6 w-6', road: 'w-14', tile: '[--road-tile:1rem]' },
  md: { truck: 'h-10 w-10', road: 'w-24', tile: '[--road-tile:1.5rem]' },
} as const

interface TruckLoaderProps {
  /** Announced to assistive tech in place of the (decorative) truck and road. */
  label?: string
  /** sm for a loader sharing a screen with other content, md for a screen of its own. */
  size?: keyof typeof sizeMap
  className?: string
}

export function TruckLoader({ label = 'Loading', size = 'md', className }: TruckLoaderProps) {
  const dimensions = sizeMap[size]
  return (
    <div
      role="status"
      aria-label={label}
      // --road-tile is the single source of truth for the dash pattern: the `road`
      // background image and the road-scroll keyframes (both in tailwind.config.ts) read
      // it, so one value keeps the scroll seamless at any size.
      className={cn('flex flex-col items-center gap-2', dimensions.tile, className)}
    >
      <Truck className={cn('animate-truck-drive text-surface-on', dimensions.truck)} strokeWidth={1.5} aria-hidden />
      {/* The road, not the truck, carries the motion: a truck bouncing on the spot reads
          as idling, while ground moving underneath a steady truck reads as driving.
          The inner strip is one tile wider than its clip box so the tile it scrolls off
          the left is always replaced from the right rather than leaving a bald patch. */}
      <div className={cn('h-0.5 overflow-hidden rounded-full text-outline-variant', dimensions.road)} aria-hidden>
        <div className="h-full w-[calc(100%+var(--road-tile))] animate-road-scroll bg-road" />
      </div>
    </div>
  )
}
