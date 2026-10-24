import { exceptionReference } from '@/lib/format/exception'

/** The exception's short reference in a muted monospace style. The tooltip carries the full id. */
export function ExceptionRef({ id, className = '' }: { id: string; className?: string }) {
  return <span title={id} className={`font-mono tracking-[0.04em] tabular-nums ${className}`}>{exceptionReference(id)}</span>
}
