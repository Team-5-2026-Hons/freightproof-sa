import { cn } from '@/lib/utils'

/** First letter of the first and last names: "Sipho van der Merwe" → "SM". */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

interface DriverAvatarProps {
  name: string
  photo: string | null
  size: number
  ring?: boolean
  decorative?: boolean
  className?: string
}

/** The driver's photo in a circle, or their initials until they add one. */
export function DriverAvatar({ name, photo, size, ring = false, decorative = false, className }: DriverAvatarProps) {
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name }
  const shape = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
    ring && 'ring-2 ring-surface-on ring-offset-2 ring-offset-surface',
    className,
  )
  const style = { width: size, height: size }

  if (photo !== null) {
    // eslint-disable-next-line @next/next/no-img-element -- a local data URL; next/image has nothing to optimise and output:'export' disables its loader
    return <img src={photo} alt={decorative ? '' : name} aria-hidden={decorative || undefined} className={cn(shape, 'object-cover')} style={style} />
  }
  return (
    <span {...a11y} className={cn(shape, 'bg-surface-container-high font-semibold text-surface-on')} style={{ ...style, fontSize: size * 0.36 }}>
      {initialsOf(name)}
    </span>
  )
}
