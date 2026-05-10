"use client"

import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  helperText?: string
  error?: string
}

export function Input({ label, helperText, error: externalError, className, onBlur, id, ...rest }: InputProps) {
  const [touched, setTouched] = useState(false)

  const error = touched ? externalError : undefined
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-[12px] font-medium leading-4 tracking-[0.03em] text-surface-on-variant"
      >
        {label}
      </label>
      <input
        id={inputId}
        onBlur={e => {
          setTouched(true)
          onBlur?.(e)
        }}
        className={cn(
          'rounded-lg border-0 bg-surface-container-low px-4 py-3 text-[16px] leading-6 text-surface-on',
          'outline-none ring-0 transition-colors duration-150',
          'focus:bg-surface-container-lowest focus:shadow-[inset_0_-2px_0_0] focus:shadow-secondary',
          'placeholder:text-surface-on-variant',
          error && 'border-l-[3px] border-l-error bg-surface-container-lowest',
          className,
        )}
        aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
        aria-invalid={!!error}
        {...rest}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-[12px] leading-4 text-error-on-container" role="alert">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="text-[12px] leading-4 text-surface-on-variant">
          {helperText}
        </p>
      )}
    </div>
  )
}
