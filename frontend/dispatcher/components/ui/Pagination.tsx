import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface PaginationProps {
  page: number
  pageSize: number
  itemCount: number
  totalItems: number
  hasPrevious: boolean
  hasNext: boolean
  isLoading?: boolean
  onPrevious: () => void
  onNext: () => void
}

/**
 * Universal cursor-style pagination footer. Purely presentational: callers own
 * cursor/offset state and data fetching, this only renders range/page text and
 * fires the previous/next callbacks — kept generic so both cursor-paginated and
 * offset-paginated list views (exceptions, trips, etc.) can share it.
 */
export function Pagination({
  page,
  pageSize,
  itemCount,
  totalItems,
  hasPrevious,
  hasNext,
  isLoading = false,
  onPrevious,
  onNext,
}: PaginationProps) {
  // A zero-item page (e.g. an empty filtered result) has no "first" item to
  // anchor a range on — render "0 of N" rather than a misleading "1–0 of N".
  const rangeStart = itemCount === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = itemCount === 0 ? 0 : (page - 1) * pageSize + itemCount

  const rangeLabel = itemCount === 0 ? `0 of ${totalItems}` : `${rangeStart}–${rangeEnd} of ${totalItems}`

  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2">
      <span className="text-[12px] font-[500] tracking-[0.03em] text-sec tabular-nums">
        {rangeLabel}
      </span>

      <div className="flex items-center gap-3">
        <span className="text-[12px] font-[500] tracking-[0.03em] text-sec tabular-nums">
          Page {page}
        </span>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous page"
            disabled={!hasPrevious || isLoading}
            onClick={onPrevious}
            iconLeft={<ChevronLeft className="w-4 h-4" />}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next page"
            disabled={!hasNext || isLoading}
            onClick={onNext}
            iconLeft={<ChevronRight className="w-4 h-4" />}
          />
        </div>
      </div>
    </div>
  )
}
