'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import type { ManifestPreviewState } from '@/lib/hooks/useManifestPreview'
import { FieldError, FieldLabel, fieldClass } from './form-parts'

export interface ManifestLookupProps {
  value: string
  onChange: (value: string) => void
  onLookUp: () => void
  state: ManifestPreviewState
  inputError: string | null
  onEmptyLeg: () => void
}

/** Step 1 of spec §11: the dispatcher types the number, FreightProof pulls the rest. */
export function ManifestLookup(
  { value, onChange, onLookUp, state, inputError, onEmptyLeg }: ManifestLookupProps,
): React.JSX.Element {
  const inputId = useId()
  const errorId = useId()
  const failure = state.status === 'failed' ? state.failure : null

  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={inputId} required>Manifest number</FieldLabel>
          <input
            id={inputId}
            value={value}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 81"
            aria-invalid={inputError !== null}
            aria-describedby={inputError ? errorId : undefined}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onLookUp()
              }
            }}
            className={fieldClass(inputError !== null)}
          />
        </div>
        <Button
          variant="secondary"
          iconLeft={<Ic n="search" s={14} />}
          onClick={onLookUp}
          loading={state.status === 'loading'}
          disabled={!value.trim()}
        >
          Look up
        </Button>
      </div>

      {inputError && <FieldError id={errorId}>{inputError}</FieldError>}

      {state.status === 'loading' && (
        <div role="status" className="mt-5 flex flex-col gap-2">
          <span className="sr-only">Looking up manifest {state.manifestNumber}…</span>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {failure && (
        <div role="alert" className="mt-4 rounded-lg bg-err-c px-4 py-3 text-[13px] font-[600] text-err-onc">
          <p className="flex items-start gap-2">
            <Ic n="warn" s={14} className="mt-[2px] text-err" />
            {failure.message}
          </p>
          {failure.kind === 'unsupported' && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onEmptyLeg}>
              Create an empty leg instead
            </Button>
          )}
          {failure.kind === 'retryable' && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onLookUp}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
