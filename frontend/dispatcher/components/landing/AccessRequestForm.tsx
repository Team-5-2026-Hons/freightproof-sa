'use client'

import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { CONTACT_EMAIL } from '@/lib/landing/content'
import {
  EMPTY_ACCESS_REQUEST,
  FLEET_SIZES,
  MESSAGE_MAX_LENGTH,
  buildAccessRequestMailto,
  hasErrors,
  validateAccessRequest,
  type AccessRequest,
  type AccessRequestErrors,
  type AccessRequestField,
} from '@/lib/landing/accessRequest'
import { cn } from '@shared/lib/utils/cn'

interface AccessRequestFormProps {
  /** Injected so tests can observe the hand-off without navigating jsdom. */
  openMailto?: (url: string) => void
}

// Visual order of the fields, so focus lands on the topmost error.
const FIELD_ORDER: readonly AccessRequestField[] = ['fullName', 'workEmail', 'company', 'role', 'fleetSize', 'message']

// Field edges use outline/80 (3.1:1 against the card) so people can see where to type.
const fieldBase = cn(
  // 16px text: iOS Safari zooms the page into any field set smaller.
  'w-full rounded-xl border bg-surf-low px-4 py-3 text-[1rem] font-medium text-on-surf',
  // /80 keeps placeholder hints at 4.9:1 on the field fill (WCAG AA).
  'placeholder:text-on-surf-v/80 transition-colors duration-150 min-h-[48px]',
  'focus:border-sec focus:bg-surf-lowest focus:outline-none',
)

interface FieldProps {
  id: string
  label: string
  error?: string
  hint?: string
  children: (describedBy: string | undefined) => ReactNode
}

function Field({ id, label, error, hint, children }: FieldProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-semibold text-on-surf">{label}</label>
      {children(describedBy)}
      {error ? (
        <p id={errorId} className="text-[0.8125rem] font-medium text-err">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-[0.8125rem] text-on-surf-v">{hint}</p>
      ) : null}
    </div>
  )
}

export function AccessRequestForm({ openMailto }: AccessRequestFormProps) {
  const uid = useId()
  const [request, setRequest] = useState<AccessRequest>(EMPTY_ACCESS_REQUEST)
  const [errors, setErrors] = useState<AccessRequestErrors>({})
  // Validate live only after the first attempt, so nobody is scolded mid-typing.
  const [attempted, setAttempted] = useState(false)
  const [handedOff, setHandedOff] = useState(false)

  const id = (field: AccessRequestField) => `${uid}-${field}`

  function update<K extends AccessRequestField>(field: K, value: AccessRequest[K]): void {
    const next = { ...request, [field]: value }
    setRequest(next)
    if (attempted) setErrors(validateAccessRequest(next))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setAttempted(true)
    const found = validateAccessRequest(request)
    setErrors(found)
    if (hasErrors(found)) {
      // Take keyboard and screen-reader users straight to the first thing to fix. Looked up
      // by field order, not by [aria-invalid] in the DOM, which hasn't re-rendered yet here.
      const first = FIELD_ORDER.find(field => found[field])
      if (first) document.getElementById(id(first))?.focus()
      return
    }
    const url = buildAccessRequestMailto(request, CONTACT_EMAIL)
    if (openMailto) openMailto(url)
    else window.location.href = url
    setHandedOff(true)
  }

  if (handedOff) {
    return (
      <div className="rounded-xl border border-outline-v/40 bg-surf-lowest p-7 shadow-level-3 md:p-9" role="status">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-chain-c text-chain-onc">
          <Check className="h-5 w-5" strokeWidth={3} />
        </span>
        <h3 className="mt-5 text-[1.5rem] font-bold tracking-[-0.02em] text-on-surf">Your email is ready to send</h3>
        <p className="mt-3 text-[1rem] leading-relaxed text-on-surf-v">
          Your mail app should have opened with the request filled in. Press send there, and
          we’ll reply to <span className="font-semibold text-on-surf">{request.workEmail.trim()}</span>.
        </p>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-on-surf-v">
          Nothing opened? Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-sec underline underline-offset-[3px]">{CONTACT_EMAIL}</a>{' '}
          directly.
        </p>
        <button
          type="button"
          onClick={() => setHandedOff(false)}
          className="mt-6 text-[0.875rem] font-semibold text-sec underline-offset-[3px] hover:underline"
        >
          Edit the request
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Request access"
      className="rounded-xl border border-outline-v/40 bg-surf-lowest p-6 shadow-level-3 md:p-9"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id('fullName')} label="Full name" error={errors.fullName}>
          {describedBy => (
            <input
              id={id('fullName')}
              className={cn(fieldBase, errors.fullName ? 'border-err' : 'border-outline/80')}
              autoComplete="name"
              value={request.fullName}
              onChange={e => update('fullName', e.target.value)}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field id={id('workEmail')} label="Work email" error={errors.workEmail}>
          {describedBy => (
            <input
              id={id('workEmail')}
              type="email"
              inputMode="email"
              className={cn(fieldBase, errors.workEmail ? 'border-err' : 'border-outline/80')}
              autoComplete="email"
              placeholder="name@company.co.za"
              value={request.workEmail}
              onChange={e => update('workEmail', e.target.value)}
              aria-invalid={Boolean(errors.workEmail)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field id={id('company')} label="Company" error={errors.company}>
          {describedBy => (
            <input
              id={id('company')}
              className={cn(fieldBase, errors.company ? 'border-err' : 'border-outline/80')}
              autoComplete="organization"
              value={request.company}
              onChange={e => update('company', e.target.value)}
              aria-invalid={Boolean(errors.company)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field id={id('role')} label="Your role" error={errors.role}>
          {describedBy => (
            <input
              id={id('role')}
              className={cn(fieldBase, errors.role ? 'border-err' : 'border-outline/80')}
              autoComplete="organization-title"
              placeholder="e.g. Operations manager"
              value={request.role}
              onChange={e => update('role', e.target.value)}
              aria-invalid={Boolean(errors.role)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field id={id('fleetSize')} label="Fleet size" error={errors.fleetSize}>
            {describedBy => (
              <div className="relative">
                <select
                  id={id('fleetSize')}
                  className={cn(fieldBase, 'appearance-none pr-11', errors.fleetSize ? 'border-err' : 'border-outline/80', !request.fleetSize && 'text-on-surf-v')}
                  value={request.fleetSize}
                  onChange={e => update('fleetSize', e.target.value as AccessRequest['fleetSize'])}
                  aria-invalid={Boolean(errors.fleetSize)}
                  aria-describedby={describedBy}
                >
                  <option value="" disabled>Choose one</option>
                  {FLEET_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surf-v" aria-hidden="true" />
              </div>
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            id={id('message')}
            label="Anything we should know? (optional)"
            error={errors.message}
            hint={`Routes, current systems, a recent incident. Up to ${MESSAGE_MAX_LENGTH} characters.`}
          >
            {describedBy => (
              <textarea
                id={id('message')}
                rows={4}
                className={cn(fieldBase, 'min-h-[120px] resize-y', errors.message ? 'border-err' : 'border-outline/80')}
                value={request.message}
                onChange={e => update('message', e.target.value)}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[40ch] text-[0.8125rem] leading-relaxed text-on-surf-v">
          This opens your mail app with the request filled in. We use it only to reply. See the{' '}
          <Link href={ROUTES.legalPrivacy} className="font-medium text-on-surf underline underline-offset-[3px] hover:text-sec">Privacy Notice</Link>.
        </p>
        <button
          type="submit"
          className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-md border border-white/10 bg-gradient-to-br from-primary to-primary-container px-[26px] text-[0.9375rem] font-semibold text-white transition-[transform,filter] duration-150 ease-out hover:brightness-[1.18] active:scale-[0.97]"
        >
          Continue in email
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
