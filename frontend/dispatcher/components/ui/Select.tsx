import { type SelectHTMLAttributes } from 'react'
import { cn } from '@shared/lib/utils/cn'
import { Ic } from './Ic'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  helperText?: string
}

export function Select({ label, error, helperText, className, id, children, ...props }: SelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-xs font-bold uppercase tracking-wider text-on-surf-v"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            'w-full rounded-xl px-4 py-3 text-sm font-medium text-on-surf appearance-none pr-10',
            'bg-surf-low border border-outline-v/30',
            'focus:outline-none focus:border-sec focus:bg-surf-lowest',
            'transition-colors duration-150 min-h-[44px]',
            error && 'border-err focus:border-err',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-on-surf-v">
          <Ic n="chev" s={14} className="rotate-90" />
        </div>
      </div>
      {error ? (
        <p className="text-xs text-err font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-on-surf-v">{helperText}</p>
      ) : null}
    </div>
  )
}
