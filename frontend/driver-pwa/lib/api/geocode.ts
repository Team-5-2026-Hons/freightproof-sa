// Reverse-geocodes GPS coordinates to a human-readable address via the Google
// Geocoding API. Display-only — never blocks a phase submit. An unset
// key is an expected, non-error state.

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

interface GoogleGeocodeResponse {
  status: string
  results: Array<{ formatted_address: string }>
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) return null

  try {
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
    console.warn('reverseGeocode: fetch/parse failed', err)
    return null
  }
}
