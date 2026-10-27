import { Button } from '@/components/ui/Button'
import { fmtTime } from '@shared/lib/utils/datetime'

interface Props {
  loadedAt: Date
  onRetry: () => void
}

/** A quiet line above a dashboard panel's rows when a refresh failed but older rows are still shown:
 *  without it the panel looks current and a dispatcher can act on stale incidents or exceptions. */
export function RefreshFailedNote({ loadedAt, onRetry }: Props): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-1.5 text-xs text-on-surf-v">
      <p role="status">Couldn&apos;t refresh · showing data from {fmtTime(loadedAt.toISOString())}</p>
      <Button size="sm" variant="ghost" onClick={onRetry}>Try again</Button>
    </div>
  )
}
