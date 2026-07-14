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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-bold uppercase tracking-wider text-surface-on-variant"
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-sm font-medium text-foreground',
          'bg-muted border border-input',
          'placeholder:text-muted-foreground/70 resize-none',
          'focus:outline-none focus:border-ring focus:bg-card',
          'transition-colors duration-150 min-h-[120px]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          showError && 'border-destructive focus:border-destructive',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p className="text-xs text-destructive font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  )
})
