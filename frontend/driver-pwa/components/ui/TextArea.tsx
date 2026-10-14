'use client'

import { type TextareaHTMLAttributes, useState, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  helperText?: string
  error?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, helperText, error, className, id, ...props },
  ref,
) {
  const [touched, setTouched] = useState(false)
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  const showError = touched && error

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-subhead text-surface-on-variant"
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          // text-base, not text-sm — see components/ui/Input.tsx for why (iOS zoom-on-focus).
          // Overhaul field, as Input: a fill, no border; 16px+ text so iOS never zooms.
          'w-full rounded-[14px] border-0 bg-fill px-4 py-3.5 text-body text-surface-on',
          'placeholder:text-surface-on-variant resize-none',
          'outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'transition-shadow duration-150 min-h-[104px]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          showError && 'ring-2 ring-error focus-visible:ring-error',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p className="text-footnote font-medium text-error">{error}</p>
      ) : helperText ? (
        <p className="text-footnote text-surface-on-variant">{helperText}</p>
      ) : null}
    </div>
  )
})
