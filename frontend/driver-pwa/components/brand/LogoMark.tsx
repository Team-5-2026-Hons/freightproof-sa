import { cn } from '@/lib/utils'

// The FreightProof mark: a road running into the distance inside a shield, ending in an
// anchored checkpoint. Same geometry as the dispatcher landing page's LogoMark (and its
// icon.svg), so the driver's first screen carries the brand people saw everywhere else.
// Ported rather than imported: frontend/shared/ is read-only for driver work, and the
// landing copy lives in the dispatcher app, which this app cannot import from.
//
// Fills are theme tokens, not the landing page's literal hexes: in the dark theme
// `primary` turns light and `surface` dark, so the shield and road swap tone together and
// the mark stays legible on either ground. The checkpoint dot is chain-c, the app's
// on-chain colour (the dot is the anchored record): bright cyan on the black shield in
// light, deep teal on the light shield in dark — the brand cyan would vanish on grey.

interface LogoMarkProps {
  /** Rendered edge length in px. */
  size?: number
  className?: string
}

const DEFAULT_MARK_SIZE_PX = 32

export function LogoMark({ size = DEFAULT_MARK_SIZE_PX, className }: LogoMarkProps) {
  return (
    // Decorative: every placement sits beside the visible "FreightProof" wordmark or a
    // heading that names the screen, so a label here would be read twice.
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path
        d="M16 1.75 27.75 5.9v8.7c0 7.4-4.95 13.05-11.75 15.65C9.2 27.65 4.25 22 4.25 14.6V5.9Z"
        className="fill-primary"
      />
      <path
        d="M14.8 11.4h2.4l4.6 14.35c-1.75 1.3-3.65 2.3-5.8 3.1-2.15-.8-4.05-1.8-5.8-3.1Z"
        className="fill-surface"
      />
      <path
        d="M16 14.2v2.1M16 18.6v2.6M16 23.5v3"
        className="stroke-primary"
        strokeWidth={1.1}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="7.9" r="2.1" className="fill-chain-c" />
    </svg>
  )
}

interface LogoProps {
  /** Mark edge length in px; the wordmark scales with it. Fixed px on purpose: a lockup
   *  is artwork, and Dynamic Type growing the word but not the mark would break it. */
  size?: number
  className?: string
}

// Ratio of wordmark cap size to mark size, taken from the landing-page lockup.
const WORDMARK_SCALE = 0.62

/** Mark + wordmark, side by side — the horizontal lockup. */
export function Logo({ size = DEFAULT_MARK_SIZE_PX, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span
        className="whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] text-surface-on"
        style={{ fontSize: size * WORDMARK_SCALE }}
      >
        FreightProof
      </span>
    </span>
  )
}
