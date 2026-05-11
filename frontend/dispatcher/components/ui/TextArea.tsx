'use client'

import { type TextareaHTMLAttributes, useState } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  helperText?: string
  error?: string
}

export function TextArea({ label, helperText, error, className, id, ...props }: TextAreaProps) {
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
        id={inputId}
        onBlur={() => setTouched(true)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
          'bg-surface-container-low border border-outline-variant/30',
          'placeholder:text-surface-on-variant/50 resize-none',
          'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
          'transition-colors duration-150 min-h-[120px]',
          showError && 'border-error focus:border-error',
          className,
        )}
        {...props}
      />
      {showError ? (
        <p className="text-xs text-error font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-surface-on-variant">{helperText}</p>
      ) : null}
    </div>
  )
}
