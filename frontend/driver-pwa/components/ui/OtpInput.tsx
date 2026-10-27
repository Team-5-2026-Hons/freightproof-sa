'use client'

import { useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  length: number
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

export function OtpInput({ length, value, onChange, autoFocus }: OtpInputProps) {
  const boxRefs = useRef<Array<HTMLInputElement | null>>([])

  function focusBox(index: number) {
    boxRefs.current[Math.max(0, Math.min(index, length - 1))]?.focus()
  }

  function writeFrom(index: number, digits: string) {
    const chars = value.split('')
    let cursor = index
    for (const digit of digits) {
      if (cursor >= length) break
      chars[cursor] = digit
      cursor += 1
    }
    onChange(chars.join('').slice(0, length))
    focusBox(cursor >= length ? length - 1 : cursor)
  }

  function applyDigits(index: number, digits: string) {
    writeFrom(digits.length >= length ? 0 : index, digits)
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '')
    if (!digits) {
      const chars = value.split('')
      chars[index] = ''
      onChange(chars.join(''))
      return
    }
    applyDigits(index, digits)
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      const chars = value.split('')
      chars[index - 1] = ''
      onChange(chars.join(''))
      focusBox(index - 1)
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusBox(index - 1)
      e.preventDefault()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusBox(index + 1)
      e.preventDefault()
    }
  }

  function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '')
    if (pasted) applyDigits(index, pasted)
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="6-digit code">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => { boxRefs.current[index] = el }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          value={value[index] ?? ''}
          autoFocus={autoFocus && index === 0}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${index + 1} of ${length}`}
          className={cn(
            'h-14 min-w-0 max-w-14 flex-1 rounded-2xl text-center text-2xl font-semibold tabular-nums text-surface-on',
            'bg-surface-container-high',
            'outline-none ring-inset focus:ring-2 focus:ring-surface-on/40',
            'transition-shadow duration-150',
          )}
        />
      ))}
    </div>
  )
}
