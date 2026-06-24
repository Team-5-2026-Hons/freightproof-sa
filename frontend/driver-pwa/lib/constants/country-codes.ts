// Country dial codes for the login country-code picker. South Africa is
// pinned first since it's this product's primary market; the rest are sorted
// alphabetically by name, matching the convention used by Google/WhatsApp's
// country pickers. Flags are Unicode regional-indicator emoji — no icon
// assets or new dependency required.

export interface CountryCode {
  /** ISO 3166-1 alpha-2 code, used as the React key. */
  iso: string
  name: string
  flag: string
  dialCode: string
  /** Example local-number placeholder, sized and grouped for this country. */
  placeholder: string
}

// Generic ascending digits, never a real number — only used to size/group the
// placeholder hint to roughly match each country's typical local-number length.
const DIGIT_CYCLE = '1234567890'

function placeholderFor(localLength: number): string {
  let digits = ''
  while (digits.length < localLength) digits += DIGIT_CYCLE
  digits = digits.slice(0, localLength)

  const groups: string[] = []
  let i = 0
  while (i < digits.length) {
    const remaining = digits.length - i
    const take = remaining <= 4 ? remaining : 3
    groups.push(digits.slice(i, i + take))
    i += take
  }
  return groups.join(' ')
}

// [iso, name, flag, dialCode, typical local-number length (as the driver types it)]
const COUNTRY_DATA: [string, string, string, string, number][] = [
  ['ZA', 'South Africa', '🇿🇦', '+27', 10],
  ['AO', 'Angola', '🇦🇴', '+244', 9],
  ['AU', 'Australia', '🇦🇺', '+61', 10],
  ['BW', 'Botswana', '🇧🇼', '+267', 8],
  ['BR', 'Brazil', '🇧🇷', '+55', 11],
  ['CA', 'Canada', '🇨🇦', '+1', 10],
  ['CN', 'China', '🇨🇳', '+86', 11],
  ['KM', 'Comoros', '🇰🇲', '+269', 7],
  ['CD', 'DR Congo', '🇨🇩', '+243', 9],
  ['EG', 'Egypt', '🇪🇬', '+20', 10],
  ['SZ', 'Eswatini', '🇸🇿', '+268', 8],
  ['FR', 'France', '🇫🇷', '+33', 10],
  ['DE', 'Germany', '🇩🇪', '+49', 11],
  ['IN', 'India', '🇮🇳', '+91', 10],
  ['IE', 'Ireland', '🇮🇪', '+353', 9],
  ['KE', 'Kenya', '🇰🇪', '+254', 9],
  ['LS', 'Lesotho', '🇱🇸', '+266', 8],
  ['MG', 'Madagascar', '🇲🇬', '+261', 9],
  ['MW', 'Malawi', '🇲🇼', '+265', 9],
  ['MU', 'Mauritius', '🇲🇺', '+230', 7],
  ['MZ', 'Mozambique', '🇲🇿', '+258', 9],
  ['NA', 'Namibia', '🇳🇦', '+264', 9],
  ['NL', 'Netherlands', '🇳🇱', '+31', 9],
  ['NG', 'Nigeria', '🇳🇬', '+234', 10],
  ['PT', 'Portugal', '🇵🇹', '+351', 9],
  ['SC', 'Seychelles', '🇸🇨', '+248', 7],
  ['SG', 'Singapore', '🇸🇬', '+65', 8],
  ['TZ', 'Tanzania', '🇹🇿', '+255', 9],
  ['GB', 'United Kingdom', '🇬🇧', '+44', 11],
  ['US', 'United States', '🇺🇸', '+1', 10],
  ['ZM', 'Zambia', '🇿🇲', '+260', 9],
  ['ZW', 'Zimbabwe', '🇿🇼', '+263', 9],
]

export const COUNTRY_CODES: CountryCode[] = COUNTRY_DATA.map(
  ([iso, name, flag, dialCode, localLength]) => ({
    iso,
    name,
    flag,
    dialCode,
    placeholder: placeholderFor(localLength),
  }),
)

export const DEFAULT_COUNTRY_CODE: CountryCode = COUNTRY_CODES[0]
