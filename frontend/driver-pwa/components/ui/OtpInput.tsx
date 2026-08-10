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

// Shopify-style block OTP entry — one bordered square per digit instead of a single
// text field, so a driver can see at a glance how many digits are left to enter.
// `value` is the single source of truth (kept in the parent, same as the old <Input>
// it replaces); each box just reads its own character out of it and writes back the
// full string on change, so auto-submit-on-complete in app/otp/page.tsx needs no changes.
export function OtpInput({ length, value, onChange, autoFocus }: OtpInputProps) {
  const boxRefs = useRef<Array<HTMLInputElement | null>>([])

  function focusBox(index: number) {
    boxRefs.current[Math.max(0, Math.min(index, length - 1))]?.focus()
  }

  // Writes `digits` into value starting at `index`, one character per box, and
  // focuses the box after the last one filled. Handles both a single keystroke
  // (one digit) and a whole code landing at once — iOS's one-time-code autofill
  // and a manual paste both deliver the full string as a single event on
  // whichever box was focused, same as the OS filling the old single-input version.
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

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '')
    if (!digits) {
      const chars = value.split('')
      chars[index] = ''
      onChange(chars.join(''))
      return
    }
    writeFrom(index, digits)
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      // Box is already empty — Shopify's pattern is to clear the previous box and
      // hop back to it, rather than doing nothing.
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
    if (pasted) writeFrom(index, pasted)
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
          maxLength={1}
          value={value[index] ?? ''}
          autoFocus={autoFocus && index === 0}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${index + 1} of ${length}`}
          className={cn(
            'h-14 w-11 rounded-xl border text-center text-2xl font-semibold text-foreground',
            'bg-muted border-input',
            'focus:outline-none focus:border-ring focus:bg-card',
            'transition-colors duration-150',
          )}
        />
      ))}
    </div>
  )
}
