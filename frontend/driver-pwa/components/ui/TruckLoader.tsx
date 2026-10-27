// Loading indicator for trip-shaped waits: a truck riding over a scrolling road.
// Preferred over the generic Spinner wherever the driver is waiting on a trip to load.
// prefers-reduced-motion is handled globally (app/globals.css), freezing both animations.
import { Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

const sizeMap = {
  sm: { truck: 'h-6 w-6', road: 'w-14', tile: '[--road-tile:1rem]' },
  md: { truck: 'h-10 w-10', road: 'w-24', tile: '[--road-tile:1.5rem]' },
} as const

interface TruckLoaderProps {
  label?: string
  size?: keyof typeof sizeMap
  className?: string
}

export function TruckLoader({ label = 'Loading', size = 'md', className }: TruckLoaderProps) {
  const dimensions = sizeMap[size]
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('flex flex-col items-center gap-2', dimensions.tile, className)}
    >
      <Truck className={cn('animate-truck-drive text-surface-on', dimensions.truck)} strokeWidth={1.5} aria-hidden />
      <div className={cn('h-0.5 overflow-hidden rounded-full text-outline-variant', dimensions.road)} aria-hidden>
        <div className="h-full w-[calc(100%+var(--road-tile))] animate-road-scroll bg-road" />
      </div>
    </div>
  )
}
