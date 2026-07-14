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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-bold uppercase tracking-wider text-surface-on-variant"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-sm font-medium text-foreground',
          'bg-muted border border-input',
          'placeholder:text-muted-foreground/70',
          'focus:outline-none focus:border-ring focus:bg-card',
          'transition-colors duration-150 min-h-[44px]',
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
