// frontend/driver-pwa/lib/ocr/parseSeal.ts
//
// Turns the text OCR read off a seal photo into seal-number candidates.
//
// Seal print is small, embossed and often curved, so OCR routinely swaps letters and
// digits that look alike. The format is fixed (XX-####, lib/utils/seal-format.ts), which
// says which half each character belongs to, so a look-alike is mapped back by position
// rather than guessed.
import { isValidSealFormat } from '@/lib/utils/seal-format'

// Two characters, an optional separator, four characters. The separator is a space, the
// plain hyphen or any unicode hyphen/dash (U+2010 to U+2015): OCR hands back whichever
// glyph the print looked most like. The word boundaries stop a longer run ("AB-12345")
// being read as a seal, and the lookahead stops the front of a longer dashed code
// ("AB-1234-5678") being read as one. Loose on purpose about which characters sit where:
// the position maps below decide what each one really is.
const CANDIDATE = /\b([A-Z0-9]{2})[\s\-\u2010-\u2015]?([A-Z0-9]{4})\b(?![\-\u2010-\u2015]?[A-Z0-9])/g

const AS_LETTER: Readonly<Record<string, string>> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' }
const AS_DIGIT: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1', S: '5', B: '8' }

function mapChars(part: string, map: Readonly<Record<string, string>>): string {
  return part.split('').map((c) => map[c] ?? c).join('')
}

export function parseSealCandidates(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.toUpperCase().matchAll(CANDIDATE)) {
    const [, letters = '', digits = ''] = match
    // A letter half with no real letter in it is a run of digits (a date like 151025, a
    // lot number), not a misread seal: mapping it would invent letters that were never
    // printed. One misread letter is still recoverable ("8O" -> "BO"); two are not.
    if (!/[A-Z]/.test(letters)) continue
    const value = `${mapChars(letters, AS_LETTER)}-${mapChars(digits, AS_DIGIT)}`
    if (isValidSealFormat(value)) found.add(value)
  }
  return [...found]
}
