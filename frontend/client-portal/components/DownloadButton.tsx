'use client'

import { useState } from 'react'
import { PackError, downloadPackFile, type PackDownload } from '@/lib/api'

interface DownloadButtonProps {
  token: string
  file: PackDownload
  filename: string
  className: string
  children: string
}

// A button, not a link: the download has to carry the viewer grant header, which
// a plain <a href> cannot send.
export function DownloadButton({ token, file, filename, className, children }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await downloadPackFile(token, file, filename)
    } catch (err: unknown) {
      setError(err instanceof PackError ? err.message : 'The download failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="no-print inline-flex flex-col items-end gap-1">
      <button type="button" className={className} disabled={busy} onClick={() => void download()}>
        {busy ? 'Preparing…' : children}
      </button>
      {error && <span role="alert" className="text-meta text-err">{error}</span>}
    </span>
  )
}
