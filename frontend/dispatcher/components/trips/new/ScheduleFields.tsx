'use client'

import { useId } from 'react'
import type { FieldErrors, ScheduleOverrides, TimeInputs } from '@/lib/trips/manifest-form'
import { FieldError, FieldLabel, FromManifestTag, fieldClass } from './form-parts'

const LOCALE = 'en-ZA'

export interface ScheduleFieldsProps {
  overrides: ScheduleOverrides
  /** The source's own times as input values; '' where it has none (always '' for an empty leg). */
  source: TimeInputs
  onChange: (overrides: ScheduleOverrides) => void
  errors: FieldErrors
}

/** Planned times, pre-filled from the manifest and editable (spec §11 step 2). They become
 *  required only where the manifest has none. */
export function ScheduleFields({ overrides, source, onChange, errors }: ScheduleFieldsProps): React.JSX.Element {
  return (
    <div className="mt-[14px] flex flex-col gap-3 sm:flex-row">
      <TimeField
        label="Planned departure (SAST)"
        required={!source.departure}
        override={overrides.departure}
        source={source.departure}
        onChange={departure => onChange({ ...overrides, departure })}
        error={errors.departure}
      />
      <TimeField
        label="Expected arrival (SAST)"
        required={false}
        override={overrides.arrival}
        source={source.arrival}
        onChange={arrival => onChange({ ...overrides, arrival })}
        error={errors.arrival}
      />
    </div>
  )
}

interface TimeFieldProps {
  label: string
  required: boolean
  override: string | null
  source: string
  onChange: (value: string | null) => void
  error?: string
}

function TimeField({ label, required, override, source, onChange, error }: TimeFieldProps): React.JSX.Element {
  const inputId = useId()
  const errorId = useId()
  const shown = override ?? source
  // "From manifest" while the field shows the manifest's own value. Once edited, a way back
  // that restores null, so the manifest's exact time is what gets locked (D2).
  const fromSource = source !== '' && shown === source
  const edited = source !== '' && !fromSource
  const parts = shown ? splitLocal(shown) : null

  return (
    <div className="min-w-0 flex-1">
      <FieldLabel htmlFor={inputId} required={required}>{label}</FieldLabel>
      <input
        id={inputId}
        type="datetime-local"
        value={shown}
        onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={fieldClass(Boolean(error))}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {/* Under the field, not beside the label: two columns leave the label row too narrow
          for a badge, and a wrapped "From manifest" pushed the inputs out of line. */}
      {(parts || fromSource || edited) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-on-surf-v">
          {parts && !error && (
            <span><span className="font-[600] text-on-surf">{parts.date}</span> · {parts.time}</span>
          )}
          {fromSource && <FromManifestTag />}
          {edited && (
            <button type="button" onClick={() => onChange(null)} className="whitespace-nowrap font-[600] text-sec hover:opacity-75">
              Use manifest time
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// The moment in words beside the single combined input, so the pick is unambiguous at a
// glance. The rest of the app has no split date and time pattern, so this keeps one input.
function splitLocal(value: string): { date: string; time: string } {
  const d = new Date(value)
  return {
    date: d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }),
  }
}
