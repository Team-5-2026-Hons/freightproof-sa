import { cn } from '@shared/lib/utils/cn'

interface LogoMarkProps {
  className?: string
  size?: number
  title?: string
}

/**
 * The FreightProof mark: a road running into the distance inside a shield, ending in an
 * anchored checkpoint. The shield is the existing sidebar motif; the road and the teal
 * node say what is being protected (the journey) and how (a record anchored on-chain).
 */
export function LogoMark({ className, title, size = 30 }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M16 1.75 27.75 5.9v8.7c0 7.4-4.95 13.05-11.75 15.65C9.2 27.65 4.25 22 4.25 14.6V5.9Z" className="fill-primary" />
      <path d="M14.8 11.4h2.4l4.6 14.35c-1.75 1.3-3.65 2.3-5.8 3.1-2.15-.8-4.05-1.8-5.8-3.1Z" className="fill-surf" />
      <path d="M16 14.2v2.1M16 18.6v2.6M16 23.5v3" className="stroke-primary" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="16" cy="7.9" r="2.1" className="fill-chain-c" />
    </svg>
  )
}

interface LogoProps {
  className?: string
  showRegion?: boolean
  size?: number
}

/** Mark + wordmark lockup. Used as the home link in the landing nav and footer. */
export function Logo({ className, size = 30, showRegion = true }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-[10px]', className)}>
      <LogoMark className="block" size={size} />
      <span
        className="font-extrabold text-on-surf leading-none tracking-[-0.03em] whitespace-nowrap"
        style={{ fontSize: size * 0.62 }}
      >
        FreightProof
        {showRegion && (
          <span className="ml-1 font-semibold text-on-surf-v tracking-[0.02em]" style={{ fontSize: size * 0.4 }}>SA</span>
        )}
      </span>
    </span>
  )
}
