'use client'

import { type InputHTMLAttributes, useState, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  helperText?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, className, id, ...props },
  ref,
) {
  const [touched, setTouched] = useState(false)
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  const showError = touched && error

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-subhead text-surface-on-variant">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        onBlur={() => setTouched(true)}
        aria-invalid={showError ? true : undefined}
        aria-describedby={showError || helperText ? `${inputId}-note` : undefined}
        className={cn(
          // Field: a fill, no border — on a white page the fill is the
          // edge, as with the grey buttons. 16px+ text, not smaller: iOS auto-zooms the
          // viewport on a focused input under 16px, and in a packaged app that zoom never
          // resets.
          'h-14 w-full rounded-[14px] border-0 bg-fill px-4 text-body font-medium text-surface-on',
          // Placeholders carry instructions ("e.g. Durban"), so they must read: the
          // on-variant ink clears 4.5:1 on the fill (contrast.test.ts).
          'placeholder:text-surface-on-variant',
          'outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'transition-shadow duration-150',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          showError && 'ring-2 ring-error focus-visible:ring-error',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p id={`${inputId}-note`} className="text-footnote font-medium text-error">{error}</p>
      ) : helperText ? (
        <p id={`${inputId}-note`} className="text-footnote text-surface-on-variant">{helperText}</p>
      ) : null}
    </div>
  )
})
