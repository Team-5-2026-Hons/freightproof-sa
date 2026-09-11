'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField } from '@/components/ui/FormField'
import { Ic } from '@/components/ui/Ic'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import {
  useBlockchainReceiptLookup,
  type BlockchainReceiptLookupCriteria,
  type BlockchainReceiptLookupType,
} from '@/lib/hooks/useBlockchainReceiptLookup'
import { cn } from '@shared/lib/utils/cn'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

const SHA_256_PATTERN = /^[0-9a-f]{64}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEDERA_TX_ID_MAX_LENGTH = 200
const HASHSCAN_BASE = (
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'
).replace(/\/+$/, '')

interface ValidationErrors {
  identifier?: string
  subjectId?: string
}

interface ReceiptFieldProps {
  label: string
  value: string
  mono?: boolean
  wide?: boolean
}

function ReceiptField({ label, value, mono = false, wide = false }: ReceiptFieldProps): JSX.Element {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">
        {label}
      </dt>
      <dd className={cn(
        'mt-[4px] text-[12px] font-[600] text-on-surf tabular-nums tracking-[0.03em]',
        mono && 'font-mono break-all whitespace-normal',
      )}>
        {value}
      </dd>
    </div>
  )
}

function ReceiptCard({ receipt, index }: { receipt: BlockchainReceipt; index: number }): JSX.Element {
  const headingId = `receipt-${receipt.id}`
  const hashScanUrl = receipt.hedera_tx_id
    ? `${HASHSCAN_BASE}/transaction/${encodeURIComponent(receipt.hedera_tx_id)}/message`
    : receipt.hedera_topic_id
      ? `${HASHSCAN_BASE}/topic/${encodeURIComponent(receipt.hedera_topic_id)}`
      : null

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-lg bg-surf-lowest p-4 shadow-level-3 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-v/20 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-chain-c text-chain">
            <Ic n="hex" s={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-[700] uppercase tracking-[0.1em] text-chain">
              Blockchain receipt
            </p>
            <h2 id={headingId} className="text-[15px] font-[800] text-on-surf">
              Receipt {index + 1}
            </h2>
          </div>
        </div>
        {hashScanUrl && (
          <a
            href={hashScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-chain-c px-3 py-2 text-[11px] font-[700] text-chain-onc transition-colors hover:brightness-95"
          >
            {receipt.hedera_tx_id ? 'View transaction message on HashScan' : 'View topic on HashScan'}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <ReceiptField label="Receipt type" value={receipt.receipt_type} mono />
        <ReceiptField label="Subject type" value={receipt.subject_type} mono />
        <ReceiptField label="Subject ID" value={receipt.subject_id} mono wide />
        <ReceiptField label="Data hash" value={receipt.data_hash} mono wide />
        <ReceiptField
          label="Hedera transaction ID"
          value={receipt.hedera_tx_id ?? 'Not recorded'}
          mono
          wide
        />
        <ReceiptField
          label="Hedera topic ID"
          value={receipt.hedera_topic_id ?? 'Not recorded'}
          mono
        />
        <ReceiptField
          label="Sequence number"
          value={receipt.hedera_sequence_number?.toString() ?? 'Not recorded'}
          mono
        />
        <ReceiptField
          label="Consensus timestamp"
          value={receipt.hedera_consensus_timestamp ?? 'Not recorded'}
          mono
        />
        <ReceiptField label="Local recorded time" value={receipt.created_at} mono />
      </dl>
    </article>
  )
}

export function ReceiptLookup(): JSX.Element {
  const [lookupType, setLookupType] = useState<BlockchainReceiptLookupType>('data_hash')
  const [identifier, setIdentifier] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({})
  const { results, loading, error, searched, clear, lookup } = useBlockchainReceiptLookup()

  const identifierLabel = lookupType === 'data_hash' ? 'SHA-256 hash' : 'Hedera transaction ID'
  const identifierPlaceholder = lookupType === 'data_hash'
    ? '64-character hexadecimal hash'
    : '0.0.1234@1788862272.000000001'

  function handleTextChange(name: string, value: string): void {
    clear()
    if (name === 'identifier') {
      setIdentifier(value)
      setValidationErrors(current => ({ ...current, identifier: undefined }))
      return
    }

    if (name === 'subjectId') {
      setSubjectId(value)
      setValidationErrors(current => ({ ...current, subjectId: undefined }))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const trimmedIdentifier = identifier.trim()
    const trimmedSubjectId = subjectId.trim()
    const nextErrors: ValidationErrors = {}

    if (!trimmedIdentifier) {
      nextErrors.identifier = 'Enter an identifier.'
    } else if (lookupType === 'data_hash' && !SHA_256_PATTERN.test(trimmedIdentifier)) {
      nextErrors.identifier = 'Enter a 64-character hexadecimal SHA-256 hash.'
    } else if (
      lookupType === 'hedera_tx_id' &&
      trimmedIdentifier.length > HEDERA_TX_ID_MAX_LENGTH
    ) {
      nextErrors.identifier = `Hedera transaction ID must be ${HEDERA_TX_ID_MAX_LENGTH} characters or fewer.`
    }

    if (trimmedSubjectId && !UUID_PATTERN.test(trimmedSubjectId)) {
      nextErrors.subjectId = 'Enter a valid UUID.'
    }

    setValidationErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      clear()
      return
    }

    const criteria: BlockchainReceiptLookupCriteria = {
      type: lookupType,
      identifier: trimmedIdentifier,
    }
    if (trimmedSubjectId) criteria.subjectId = trimmedSubjectId
    void lookup(criteria)
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <section className="rounded-lg bg-surf-lowest p-4 shadow-level-3 sm:p-5">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-chain-c text-chain">
            <Ic n="search" s={17} />
          </span>
          <div>
            <h1 className="text-[15px] font-[800] text-on-surf">Find an anchored receipt</h1>
            <p className="mt-1 text-[12px] leading-relaxed text-on-surf-v">
              Search by one exact chain identifier. Add a subject UUID only when you need to narrow visible matches.
            </p>
          </div>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[220px_minmax(280px,1fr)_minmax(240px,1fr)_auto]"
        >
          <Select
            label="Search by"
            value={lookupType}
            onChange={(event) => {
              clear()
              setLookupType(event.target.value as BlockchainReceiptLookupType)
              setValidationErrors(current => ({ ...current, identifier: undefined }))
            }}
          >
            <option value="data_hash">SHA-256 hash</option>
            <option value="hedera_tx_id">Hedera transaction ID</option>
          </Select>

          <FormField
            label={identifierLabel}
            name="identifier"
            value={identifier}
            onChange={handleTextChange}
            error={validationErrors.identifier}
            placeholder={identifierPlaceholder}
            required
          />

          <FormField
            label="Subject UUID (optional)"
            name="subjectId"
            value={subjectId}
            onChange={handleTextChange}
            error={validationErrors.subjectId}
            placeholder="123e4567-e89b-42d3-a456-426614174000"
          />

          <div className="flex items-end">
            <Button
              type="submit"
              loading={loading}
              iconLeft={<Ic n="search" s={14} />}
              className="min-h-[44px] w-full xl:w-auto"
            >
              Search receipts
            </Button>
          </div>
        </form>
        {(validationErrors.identifier || validationErrors.subjectId) && (
          <div role="alert" className="mt-4 rounded-md bg-err-c p-3 text-[12px] text-err-onc">
            <p className="font-[700]">Check the search fields.</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {validationErrors.identifier && <li>{identifierLabel}: {validationErrors.identifier}</li>}
              {validationErrors.subjectId && <li>Subject UUID: {validationErrors.subjectId}</li>}
            </ul>
          </div>
        )}
      </section>

      <div aria-live="polite">
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-lg bg-surf-lowest px-6 py-14 shadow-level-3">
            <Spinner size="lg" />
            <p className="text-[13px] font-[600] text-on-surf-v">Searching receipt ledger...</p>
          </div>
        ) : error ? (
          <div role="alert" className="flex items-start gap-3 rounded-lg bg-err-c px-4 py-4 text-err-onc">
            <Ic n="warn" s={19} className="mt-0.5 shrink-0 text-err" />
            <div className="min-w-0 break-words">
              <p className="text-[13px] font-[700]">Receipt lookup failed</p>
              <p className="mt-1 text-[12px] leading-relaxed">{error}</p>
            </div>
          </div>
        ) : searched && results.length === 0 ? (
          <div className="rounded-lg bg-surf-lowest shadow-level-3">
            <EmptyState
              icon={<Ic n="hex" s={32} />}
              title="No matching receipts"
              body="No blockchain receipts visible to your account match those identifiers."
            />
          </div>
        ) : results.length > 0 ? (
          <section aria-labelledby="receipt-results-heading" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 id="receipt-results-heading" className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">
                Matching receipts
              </h2>
              <span className="text-[11px] font-[600] tabular-nums text-sec">
                {results.length} {results.length === 1 ? 'receipt' : 'receipts'}
              </span>
            </div>
            <p className="px-1 text-[12px] leading-relaxed text-on-surf-v">
              These results are stored receipts, not an independent verification. On HashScan, locate the topic message and compare the hash it contains with the data hash shown here.
            </p>
            {results.map((receipt, index) => (
              <ReceiptCard key={receipt.id} receipt={receipt} index={index} />
            ))}
          </section>
        ) : null}
      </div>
    </div>
  )
}
