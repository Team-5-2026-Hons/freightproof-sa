import type { InputHTMLAttributes } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface FormFieldProps {
  label: string
  name: string
  type?: string
  value: string
  onChange: (name: string, value: string) => void
  error?: string
  helperText?: string
  required?: boolean
  maxLength?: number
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  placeholder?: string
}

export function FormField({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  helperText,
  required,
  maxLength,
  inputMode,
  placeholder,
}: FormFieldProps) {
  const showError = Boolean(error)

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-surface-on-variant">
        {label}
        {required && ' *'}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        className={cn(
          'border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest',
          'text-surface-on focus:outline-none focus:ring-2 focus:ring-primary',
          showError && 'border-error focus:ring-error',
        )}
      />
      {showError ? (
        <span className="text-xs text-error">{error}</span>
      ) : helperText ? (
        <span className="text-xs text-surface-on-variant">{helperText}</span>
      ) : null}
    </label>
  )
}
