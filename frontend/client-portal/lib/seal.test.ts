import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSealedSeal, makeView } from '@/test/factories'
import { readSealPayload, sealedString } from './seal'

afterEach(() => vi.restoreAllMocks())

describe('readSealPayload', () => {
  it('reads the fields the seal commits to', async () => {
    const seal = await makeSealedSeal()

    const read = readSealPayload(seal)

    expect(read.state).toBe('ok')
    expect(sealedString(read, 'pdf_sha256')).toBe(seal.pdf_sha256)
    expect(sealedString(read, 'manifest_sha256')).toBe(seal.manifest_sha256)
  })

  it('is absent for a pack issued without a seal', () => {
    expect(readSealPayload(makeView().seal)).toEqual({ state: 'absent' })
  })

  it.each([['{not json'], ['[1,2]'], ['"text"'], ['null']])('is unreadable, and logged, for the payload %s', async (payload) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const seal = await makeSealedSeal()
    seal.seal!.canonical_payload = payload

    const read = readSealPayload(seal)

    expect(read).toEqual({ state: 'unreadable' })
    expect(warn).toHaveBeenCalled()
  })

  it('treats a field of the wrong type as missing', async () => {
    const seal = await makeSealedSeal({ pdf_sha256: 12345 })

    expect(sealedString(readSealPayload(seal), 'pdf_sha256')).toBeNull()
  })
})
