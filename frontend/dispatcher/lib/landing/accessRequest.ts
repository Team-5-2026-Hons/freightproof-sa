// Pure logic behind the landing page's "Request access" form. There is no sign-up
// endpoint (accounts are provisioned per operator), so a request becomes a pre-filled
// email the visitor sends themselves: nothing is stored, and nothing goes to a third party.

export const FLEET_SIZES = ['1–10 trucks', '11–50 trucks', '51–200 trucks', 'More than 200 trucks'] as const
export type FleetSize = (typeof FLEET_SIZES)[number]

export interface AccessRequest {
  fullName: string
  workEmail: string
  company: string
  role: string
  fleetSize: FleetSize | ''
  message: string
}

export type AccessRequestField = keyof AccessRequest
export type AccessRequestErrors = Partial<Record<AccessRequestField, string>>

export const EMPTY_ACCESS_REQUEST: AccessRequest = {
  fullName: '',
  workEmail: '',
  company: '',
  role: '',
  fleetSize: '',
  message: '',
}

export const MESSAGE_MAX_LENGTH = 600
export const SHORT_FIELD_MAX_LENGTH = 120

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateAccessRequest(request: AccessRequest): AccessRequestErrors {
  const errors: AccessRequestErrors = {}
  const required: [AccessRequestField, string][] = [
    ['fullName', 'Enter your name.'],
    ['company', 'Enter your company’s name.'],
    ['role', 'Enter your role so we know who we’re talking to.'],
  ]

  for (const [field, message] of required) {
    const value = request[field].trim()
    if (!value) errors[field] = message
    else if (value.length > SHORT_FIELD_MAX_LENGTH) errors[field] = `Keep this under ${SHORT_FIELD_MAX_LENGTH} characters.`
  }

  const email = request.workEmail.trim()
  if (!email) errors.workEmail = 'Enter your work email so we can reply.'
  else if (!EMAIL_PATTERN.test(email)) errors.workEmail = 'That email address doesn’t look complete, for example name@company.co.za.'

  if (!request.fleetSize) errors.fleetSize = 'Choose your fleet size.'

  if (request.message.length > MESSAGE_MAX_LENGTH) {
    errors.message = `Keep your note under ${MESSAGE_MAX_LENGTH} characters.`
  }

  return errors
}

export function hasErrors(errors: AccessRequestErrors): boolean {
  return Object.keys(errors).length > 0
}

/** Builds the mailto: URL. Assumes the request already passed validation. */
export function buildAccessRequestMailto(request: AccessRequest, to: string): string {
  const subject = `Access request: ${request.company.trim()}`
  const lines = [
    `Name: ${request.fullName.trim()}`,
    `Work email: ${request.workEmail.trim()}`,
    `Company: ${request.company.trim()}`,
    `Role: ${request.role.trim()}`,
    `Fleet size: ${request.fleetSize}`,
  ]
  const note = request.message.trim()
  if (note) lines.push('', note)

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
}
