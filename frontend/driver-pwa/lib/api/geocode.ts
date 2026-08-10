// frontend/driver-pwa/lib/api/geocode.ts
//
// Reverse-geocodes GPS coordinates to a human-readable address via the Google
// Geocoding API. Display-only — never blocks handshake submission. No API key
// has been provisioned yet, so an unset key is an expected, non-error state.

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

interface GoogleGeocodeResponse {
  status: string
  results: Array<{ formatted_address: string }>
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // Key not provisioned yet — expected during this phase, not a failure worth warning about.
  if (!apiKey) return null

  try {
    // URLSearchParams handles encoding for us — defense-in-depth against malformed
    // or unexpectedly-charactered coordinates/keys reaching the query string raw.
    const params = new URLSearchParams({ latlng: `${lat},${lng}`, key: apiKey })
    const resp = await fetch(`${GOOGLE_GEOCODE_URL}?${params}`)

    if (!resp.ok) {
      console.warn(`reverseGeocode: HTTP ${resp.status} from Google Geocoding API`)
      return null
    }

    const data = (await resp.json()) as GoogleGeocodeResponse

    if (data.status !== 'OK' || !data.results[0]) {
      console.warn(`reverseGeocode: Google Geocoding API returned status "${data.status}"`)
      return null
    }

    return data.results[0].formatted_address
  } catch (err) {
    // Network failure, JSON parse failure, etc. — display-only feature, degrade silently
    // to the UI but still surface a warning for diagnosis.
    console.warn('reverseGeocode: fetch/parse failed', err)
    return null
  }
}
