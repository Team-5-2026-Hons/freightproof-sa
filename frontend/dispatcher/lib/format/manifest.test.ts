import { describe, expect, it } from 'vitest'
import { fmtManifestCargo, manifestClient, manifestKey, manifestLabel } from './manifest'

const REF = { issuer_account: 'MOCK01', origin_hub: 'JNB', number: 69, display: 'CGY Logistics · JNB 69' }

describe('manifestLabel', () => {
  it('shows the manifest display when the trip has one', () => {
    expect(manifestLabel(REF, 'loaded')).toBe('CGY Logistics · JNB 69')
  })

  it('says "Empty leg" only when the trip type proves it', () => {
    expect(manifestLabel(null, 'empty_leg')).toBe('Empty leg')
  })

  it('says "No manifest" for a loaded trip without one, or when the type is unknown', () => {
    expect(manifestLabel(null, 'loaded')).toBe('No manifest')
    expect(manifestLabel(null, null)).toBe('No manifest')
  })
})

describe('fmtManifestCargo', () => {
  const totals = { waybills: 2, parcels: 5, weight_kg: 180.5 }

  it('gives waybills, parcels and weight', () => {
    expect(fmtManifestCargo(totals)).toBe('2 waybills · 5 parcels · 180.5 kg')
  })

  it('leaves the weight out when asked', () => {
    expect(fmtManifestCargo(totals, { withWeight: false })).toBe('2 waybills · 5 parcels')
  })
})

describe('manifestKey', () => {
  it('gives the manifest identifier without the client', () => {
    expect(manifestKey(REF, 'loaded')).toBe('JNB 69')
  })

  it('falls back to the label for a trip without a manifest', () => {
    expect(manifestKey(null, 'empty_leg')).toBe('Empty leg')
  })
})

describe('manifestClient', () => {
  it('returns the client half of the display label', () => {
    expect(manifestClient(REF)).toBe('CGY Logistics')
  })

  it('keeps a client name that itself contains the separator', () => {
    expect(manifestClient({ ...REF, display: 'Smith · Sons Freight · JNB 69' })).toBe('Smith · Sons Freight')
  })

  it('is null without a manifest, or when the label does not end in the key', () => {
    expect(manifestClient(null)).toBeNull()
    expect(manifestClient({ ...REF, display: 'Something else entirely' })).toBeNull()
  })
})
