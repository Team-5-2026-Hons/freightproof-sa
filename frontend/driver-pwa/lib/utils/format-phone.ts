// Phone numbers as a driver reads them aloud. Display only: what is stored and sent is
// always the plain E.164 string (+27825550001).

import { COUNTRY_CODES } from '@/lib/constants/country-codes'

/**
 * Groups a national number 2-3-4 (81 046 3076), dropping one leading trunk '0', so a
 * transposed digit is easy to spot.
 */
export function groupNationalNumber(nationalNumber: string): string {
  const digits = nationalNumber.replace(/^0/, '')
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5)].filter(Boolean).join(' ')
}

const DIAL_CODES_LONGEST_FIRST = [...new Set(COUNTRY_CODES.map((c) => c.dialCode))]
  .sort((a, b) => b.length - a.length)

/**
 * "+27825550001" → "+27 82 555 0001". A string that is not a known-country E.164 number
 * comes back unchanged rather than half-formatted.
 */
export function formatPhoneForDisplay(e164: string): string {
  const dialCode = DIAL_CODES_LONGEST_FIRST.find((code) => e164.startsWith(code))
  if (dialCode === undefined) return e164
  const national = e164.slice(dialCode.length)
  if (!/^\d+$/.test(national)) return e164
  return `${dialCode} ${groupNationalNumber(national)}`
}
