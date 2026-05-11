// All driver-pwa route strings and builders — never write URL literals in components.
// Step page URLs match spec §8.0: /trip/[id]/handshake/[h]/step/[n]-[slug]

export const ROUTES = {
  home:     '/',
  login:    '/login',
  settings: '/settings',

  handshakeStep: (tripId: string, handshake: number, slug: string) =>
    `/trip/${tripId}/handshake/${handshake}/step/${slug}`,

  inTransit:  (tripId: string) => `/trip/${tripId}/in-transit`,
  checkpoint: (tripId: string) => `/trip/${tripId}/in-transit/checkpoint`,
  upload:     (tripId: string) => `/trip/${tripId}/in-transit/upload`,
  exception:  (tripId: string) => `/trip/${tripId}/in-transit/exception`,

  panic:          (tripId: string) => `/trip/${tripId}/panic`,
  panicSubmitted: (tripId: string) => `/trip/${tripId}/panic/submitted`,

  devTokens: '/dev/tokens',
} as const
