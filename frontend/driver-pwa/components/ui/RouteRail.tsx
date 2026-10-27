import { cn } from '@/lib/utils'

export interface RouteStop {
  id: string
  eyebrow?: string
  name: string
  detail?: string
  reached: boolean
}

interface RouteRailProps {
  stops: readonly RouteStop[]
  className?: string
}

/**
 * Origin-to-destination as a vertical rail: circles for stops, a square for the
 * destination, joined by an ink line (the convention from Uber's trip screens, so the
 * shape is read before the words). The stop count is data — a cross-dock plan simply
 * passes more stops.
 */
export function RouteRail({ stops, className }: RouteRailProps) {
  return (
    <ol aria-label="Route" className={cn('flex flex-col', className)}>
      {stops.map((stop, i) => {
        const isLast = i === stops.length - 1
        return (
          <li key={stop.id} className="grid grid-cols-[24px_1fr] gap-x-4">
            <div aria-hidden className="flex flex-col items-center pt-1.5">
              <span
                data-route-marker={isLast ? 'destination' : 'stop'}
                data-reached={stop.reached ? 'true' : 'false'}
                className={cn(
                  'size-3 shrink-0 border-2 border-surface-on',
                  isLast ? 'rounded-[2px]' : 'rounded-full',
                  stop.reached && 'bg-surface-on',
                )}
              />
              {!isLast && <span className="my-1 w-0.5 flex-1 bg-surface-on" />}
            </div>
            <div className={cn(!isLast && 'pb-5')}>
              {stop.reached && <span className="sr-only">Reached: </span>}
              {stop.eyebrow !== undefined && <p className="text-subhead text-surface-on-variant">{stop.eyebrow}</p>}
              <p className="text-headline text-surface-on">{stop.name}</p>
              {stop.detail !== undefined && <p className="text-subhead text-surface-on-variant">{stop.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
