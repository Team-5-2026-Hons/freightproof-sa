// The product's own mark: the same icon the driver taps on their home screen, so the
// first screen they see after launching is visibly the thing they just opened (audit H10).
// Rounded to the iOS app-icon mask (~22% corner radius) for the same reason.

interface AppMarkProps {
  /** Rendered edge length in px. */
  size?: number
  className?: string
}

const DEFAULT_MARK_SIZE_PX = 72
const ICON_SRC = '/icons/icon-192.png'

export function AppMark({ size = DEFAULT_MARK_SIZE_PX, className }: AppMarkProps) {
  return (
    // A plain <img>, not next/image: this app is a static export (output: 'export'), so
    // the image optimiser does not exist at runtime, and the 192px source is already the
    // right size for a 72pt mark at 2-3x. Decorative — the wordmark beside it names it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ICON_SRC}
      alt=""
      width={size}
      height={size}
      className={`rounded-[22%] shadow-level-3 ${className ?? ''}`}
    />
  )
}
