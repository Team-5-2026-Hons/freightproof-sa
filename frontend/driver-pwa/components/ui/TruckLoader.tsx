// Loading indicator for trip-shaped waits: a truck riding over a scrolling road.
// Preferred over the generic Spinner wherever the driver is waiting on a trip to load.
// prefers-reduced-motion is handled globally (app/globals.css), freezing both animations.
import { Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Truck, road width and dash tile scale together so the road never reads as a dropped underline.
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
      // --road-tile is read by both the `road` background image and the road-scroll
      // keyframes (tailwind.config.ts), keeping the scroll seamless at any size.
      className={cn('flex flex-col items-center gap-2', dimensions.tile, className)}
    >
      <Truck className={cn('animate-truck-drive text-surface-on', dimensions.truck)} strokeWidth={1.5} aria-hidden />
      <div className={cn('h-0.5 overflow-hidden rounded-full text-outline-variant', dimensions.road)} aria-hidden>
        <div className="h-full w-[calc(100%+var(--road-tile))] animate-road-scroll bg-road" />
      </div>
    </div>
  )
}
