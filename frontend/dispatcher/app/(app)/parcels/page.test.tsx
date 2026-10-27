import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import { BARCODE, WAYBILL, makeTrace } from '@/components/parcels/__fixtures__/trace'
import ParcelSearchPage from './page'

const route = vi.hoisted(() => ({ query: '', user: { id: 'user-a', organization_id: 'org-a' } as { id: string; organization_id: string } | null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.query),
}))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: route.user }) }))
vi.mock('@/components/ui/TopBar', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/lib/api/client', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  return { api: { get: vi.fn() }, ApiError }
})
const get = vi.mocked(api.get)

const lookup = { barcode: BARCODE, items: [{ waybill_reference: WAYBILL, journey_count: 1 }], next_after: null }

beforeEach(() => {
  get.mockReset()
  route.query = ''
  route.user = { id: 'user-a', organization_id: 'org-a' }
})

describe('Parcel Search route', () => {
  it('keeps the barcode textbox mounted when the URL query changes', () => {
    get.mockReturnValue(new Promise(() => undefined))
    const { rerender } = render(<ParcelSearchPage />)
    const textbox = screen.getByRole('textbox', { name: 'Parcel barcode' })

    route.query = new URLSearchParams({ barcode: BARCODE }).toString()
    rerender(<ParcelSearchPage />)

    expect(screen.getByRole('textbox', { name: 'Parcel barcode' })).toBe(textbox)
  })

  it('withdraws evidence when the signed-in organisation changes', async () => {
    route.query = new URLSearchParams({ barcode: BARCODE }).toString()
    get.mockResolvedValueOnce(lookup).mockResolvedValueOnce(makeTrace()).mockReturnValueOnce(new Promise(() => undefined))
    const { rerender } = render(<ParcelSearchPage />)
    await screen.findByRole('region', { name: 'Current recorded state' })

    route.user = { id: 'user-a', organization_id: 'org-b' }
    rerender(<ParcelSearchPage />)

    expect(screen.queryByRole('region', { name: 'Current recorded state' })).not.toBeInTheDocument()
  })
})
