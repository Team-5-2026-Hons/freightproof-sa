'use client'

import { ExceptionMoreRow, ExceptionRow, type ExceptionRowData, type OpenException } from './ExceptionRow'

interface Props {
  rows: readonly ExceptionRowData[]
  hiddenCount: number
  phaseId: string | null
  selectedId: string | null
  highlightedId: string | null
  onOpen: OpenException
}

/** A collapsed card's exception rows, shown under its verdict so an exception is never hidden
 *  behind a closed card. Open, the same rows move into the rail instead (never both). */
export function ExceptionRowList({ rows, hiddenCount, phaseId, selectedId, highlightedId, onOpen }: Props) {
  return (
    <div className="mt-2 space-y-2">
      {rows.map(({ exception, at }) => (
        <ExceptionRow
          key={exception.id}
          exception={exception}
          at={at}
          phaseId={phaseId}
          selected={exception.id === selectedId}
          highlighted={exception.id === highlightedId}
          onOpen={onOpen}
        />
      ))}
      {hiddenCount > 0 && <ExceptionMoreRow hiddenCount={hiddenCount} phaseId={phaseId} onOpen={onOpen} />}
    </div>
  )
}
