'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/lib/hooks/useToast'
import { clearSavedColumnLayouts } from '@/lib/hooks/useTableColumns'
import {
  LANDING_OPTIONS,
  ROWS_PER_PAGE_OPTIONS,
  readPreferences,
  writePreferences,
  type LandingPageId,
  type RowsPerPage,
} from '@/lib/preferences'

// The select hands back a string; only an offered value may become a preference.
function asLandingPageId(value: string): LandingPageId | undefined {
  return LANDING_OPTIONS.find(option => option.id === value)?.id
}

function asRowsPerPage(value: string): RowsPerPage | undefined {
  return ROWS_PER_PAGE_OPTIONS.find(option => String(option) === value)
}

export function DisplaySection() {
  const { notify } = useToast()
  const [preferences, setPreferences] = useState(readPreferences)

  const handleLandingChange = (value: string): void => {
    const landingPage = asLandingPageId(value)
    if (landingPage) setPreferences(writePreferences({ landingPage }))
  }

  const handleRowsChange = (value: string): void => {
    const rowsPerPage = asRowsPerPage(value)
    if (rowsPerPage) setPreferences(writePreferences({ rowsPerPage }))
  }

  const handleResetColumns = (): void => {
    const cleared = clearSavedColumnLayouts()
    notify(cleared === 0
      ? { kind: 'info', title: 'No saved column widths to reset' }
      : { kind: 'success', title: `Column widths reset on ${cleared} ${cleared === 1 ? 'table' : 'tables'}` })
  }

  return (
    <Card className="p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Landing page"
          value={preferences.landingPage}
          onChange={event => handleLandingChange(event.target.value)}
          helperText="Where you arrive after signing in."
        >
          {LANDING_OPTIONS.map(option => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </Select>
        <Select
          label="Rows per page"
          value={String(preferences.rowsPerPage)}
          onChange={event => handleRowsChange(event.target.value)}
          helperText="Trip History and Exceptions history."
        >
          {ROWS_PER_PAGE_OPTIONS.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      </div>
      <div className="mt-6 flex items-center justify-between gap-6 border-t border-outline-v/20 pt-4">
        <p className="text-sm text-on-surf-v">
          Tables remember the column widths you drag. Reset them to the defaults.
        </p>
        <Button variant="secondary" onClick={handleResetColumns}>Reset column widths</Button>
      </div>
      <p className="mt-4 text-xs text-on-surf-v">Saved on this browser only.</p>
    </Card>
  )
}
