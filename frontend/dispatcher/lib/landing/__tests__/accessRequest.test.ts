import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACCESS_REQUEST,
  MESSAGE_MAX_LENGTH,
  SHORT_FIELD_MAX_LENGTH,
  buildAccessRequestMailto,
  hasErrors,
  validateAccessRequest,
  type AccessRequest,
} from '../accessRequest'

function validRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    fullName: 'Thandi Mokoena',
    workEmail: 'thandi@carrier.co.za',
    company: 'Carrier & Sons',
    role: 'Operations manager',
    fleetSize: '11–50 trucks',
    message: '',
    ...overrides,
  }
}

describe('validateAccessRequest', () => {
  it('validate_complete_request_has_no_errors', () => {
    const errors = validateAccessRequest(validRequest())

    expect(hasErrors(errors)).toBe(false)
  })

  it('validate_empty_request_flags_every_required_field', () => {
    const errors = validateAccessRequest(EMPTY_ACCESS_REQUEST)

    expect(Object.keys(errors).sort()).toEqual(['company', 'fleetSize', 'fullName', 'role', 'workEmail'])
    expect(errors.message).toBeUndefined()
  })

  it('validate_whitespace_only_counts_as_empty', () => {
    const errors = validateAccessRequest(validRequest({ fullName: '   ', company: '\t' }))

    expect(errors.fullName).toBeDefined()
    expect(errors.company).toBeDefined()
  })

  it.each(['thandi', 'thandi@', 'thandi@carrier', '@carrier.co.za', 'two words@carrier.co.za'])(
    'validate_incomplete_email_%s_is_rejected',
    email => {
      const errors = validateAccessRequest(validRequest({ workEmail: email }))

      expect(errors.workEmail).toMatch(/doesn’t look complete/)
    },
  )

  it('validate_overlong_fields_are_rejected', () => {
    const errors = validateAccessRequest(validRequest({
      role: 'x'.repeat(SHORT_FIELD_MAX_LENGTH + 1),
      message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1),
    }))

    expect(errors.role).toBeDefined()
    expect(errors.message).toBeDefined()
  })

  it('validate_message_at_the_limit_is_accepted', () => {
    const errors = validateAccessRequest(validRequest({ message: 'x'.repeat(MESSAGE_MAX_LENGTH) }))

    expect(errors.message).toBeUndefined()
  })
})

describe('buildAccessRequestMailto', () => {
  it('build_addresses_the_contact_and_names_the_company_in_the_subject', () => {
    const url = buildAccessRequestMailto(validRequest(), 'freightproof@gmail.com')

    expect(url.startsWith('mailto:freightproof@gmail.com?subject=')).toBe(true)
    const subject = decodeURIComponent(url.split('subject=')[1].split('&body=')[0])
    expect(subject).toBe('Access request: Carrier & Sons')
  })

  it('build_encodes_ampersands_so_the_body_is_not_truncated', () => {
    const url = buildAccessRequestMailto(validRequest(), 'freightproof@gmail.com')

    // A raw '&' in the company name would start a new mailto parameter.
    expect(url.match(/&/g)).toHaveLength(1)
  })

  it('build_body_lists_every_field_and_appends_the_note', () => {
    const url = buildAccessRequestMailto(validRequest({ message: 'We run the N3 nightly.' }), 'a@b.co')

    const body = decodeURIComponent(url.split('&body=')[1])
    expect(body).toContain('Name: Thandi Mokoena')
    expect(body).toContain('Work email: thandi@carrier.co.za')
    expect(body).toContain('Fleet size: 11–50 trucks')
    expect(body.endsWith('\n\nWe run the N3 nightly.')).toBe(true)
  })

  it('build_omits_the_note_block_when_empty_and_never_uses_plus_for_spaces', () => {
    const url = buildAccessRequestMailto(validRequest(), 'a@b.co')

    expect(url).not.toContain('+')
    expect(decodeURIComponent(url.split('&body=')[1]).endsWith('Fleet size: 11–50 trucks')).toBe(true)
  })
})
