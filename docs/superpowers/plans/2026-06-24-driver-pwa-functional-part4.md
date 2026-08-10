# Driver PWA Fully Functional — Part 4 (Phases F, G, H, I)

> Continuation of `2026-06-24-driver-pwa-functional-part3.md`. Same REQUIRED SUB-SKILL applies. This is the final part.

---

# Phase F — Frontend API client + auth/trip wiring

### Task 21: Typed fetch client + real OTP auth

**Files:**
- Create: `frontend/driver-pwa/lib/api/client.ts`
- Create: `frontend/driver-pwa/lib/api/auth.ts`
- Modify: `frontend/driver-pwa/lib/context/AuthContext.tsx`
- Modify: `frontend/driver-pwa/app/page.tsx`
- Modify: `frontend/driver-pwa/.env.local.example` (create if it doesn't exist)

- [ ] **Step 1: Typed client** — no raw `fetch()` anywhere else per CLAUDE.md:

```typescript
// frontend/driver-pwa/lib/api/client.ts
// Single fetch wrapper — every lib/api/*.ts module goes through this.
// Reads the driver JWT from localStorage (set by signIn in AuthContext) and
// attaches it as a Bearer token. Throws ApiError on any non-2xx response.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1'
const TOKEN_STORAGE_KEY = 'fp_driver_token'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return
  if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY)
  else localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  formData?: FormData
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!options.formData) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, detail.detail ?? 'Request failed')
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
```

- [ ] **Step 2: Auth API module**

```typescript
// frontend/driver-pwa/lib/api/auth.ts
import { apiRequest } from './client'
import type { Driver } from '@shared/lib/types/driver'

export async function requestOtp(phoneNumber: string): Promise<void> {
  await apiRequest<{ status: string }>('/auth/driver/otp/request', {
    method: 'POST',
    body: { phone_number: phoneNumber },
  })
}

export async function verifyOtp(phoneNumber: string, code: string): Promise<{ access_token: string; driver: Driver }> {
  return apiRequest('/auth/driver/otp/verify', {
    method: 'POST',
    body: { phone_number: phoneNumber, code },
  })
}
```

- [ ] **Step 3: Wire `AuthContext.tsx`** — replace the mock implementation:

```typescript
"use client"

import { createContext, useState, useCallback, useEffect } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import { requestOtp as apiRequestOtp, verifyOtp as apiVerifyOtp } from '@/lib/api/auth'
import { getStoredToken, setStoredToken } from '@/lib/api/client'
import { ApiError } from '@/lib/api/client'

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DriverUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount, a stored token means a previous session exists, but we don't have
  // a GET /auth/driver/me endpoint to re-derive the driver from it — the simplest
  // correct behaviour until one exists is to require re-auth, clearing any stale
  // token rather than holding state we can't verify.
  useEffect(() => {
    if (getStoredToken() === null) setIsLoading(false)
    else { setStoredToken(null); setIsLoading(false) }
  }, [])

  const requestOtp = useCallback(async (phone_number: string) => {
    setIsLoading(true)
    try {
      await apiRequestOtp(phone_number)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signIn = useCallback(async (credentials: { phone_number: string; otp: string }) => {
    setIsLoading(true)
    try {
      const { access_token, driver } = await apiVerifyOtp(credentials.phone_number, credentials.otp)
      setStoredToken(access_token)
      setUser(driver)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setStoredToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
```

Re-export `ApiError` from `client.ts` is already covered by Step 1's `export class ApiError` — remove the duplicate `import { ApiError }` line above (single import is enough); keep it only if the login page (Task 21 Step 5) needs to catch it.

- [ ] **Step 4: Root page redirect** — replace the Phase 0 scaffold:

```typescript
// frontend/driver-pwa/app/page.tsx
"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { useTrip } from '@/lib/hooks/useTrip'
import { ROUTES } from '@/lib/constants/routes'
import { Spinner } from '@/components/ui/Spinner'

export default function RootPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { trip } = useTrip()
  const router = useRouter()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.replace(ROUTES.login); return }
    router.replace(trip ? `/trips/${trip.id}` : ROUTES.devTokens === ROUTES.devTokens ? '/trips' : '/trips')
  }, [authLoading, user, trip, router])

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner />
    </main>
  )
}
```

(The `ROUTES.devTokens === ROUTES.devTokens ? '/trips' : '/trips'` ternary above is a placeholder typo to delete — just use `router.replace(trip ? \`/trips/${trip.id}\` : '/trips')`. Caught here so it doesn't survive into the actual edit.)

Corrected:
```typescript
    router.replace(trip ? `/trips/${trip.id}` : '/trips')
```

- [ ] **Step 5: Manual verification** (no backend integration test for a frontend redirect — covered by the `run` skill once Task 22 lands real trip fetching)

Run: `cd frontend/driver-pwa && npm run dev` and visit `http://localhost:3001` — confirm it redirects to `/login` when logged out.

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/lib/api/client.ts frontend/driver-pwa/lib/api/auth.ts \
        frontend/driver-pwa/lib/context/AuthContext.tsx frontend/driver-pwa/app/page.tsx
git commit -m "feat(auth): wire driver-pwa AuthContext to real OTP backend endpoints"
```

---

### Task 22: Trip/manifest/artifact/exception/checkpoint API modules + `TripContext` wiring

**Files:**
- Create: `frontend/driver-pwa/lib/api/trips.ts`
- Create: `frontend/driver-pwa/lib/api/manifest.ts`
- Create: `frontend/driver-pwa/lib/api/artifacts.ts`
- Create: `frontend/driver-pwa/lib/api/exceptions.ts`
- Create: `frontend/driver-pwa/lib/api/checkpoints.ts`
- Modify: `frontend/driver-pwa/lib/context/TripContext.tsx`

- [ ] **Step 1: Trips module**

```typescript
// frontend/driver-pwa/lib/api/trips.ts
import { apiRequest } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type {
  H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
} from '@shared/lib/types/handshake-requests'

export async function fetchMyActiveTrip(): Promise<Trip | null> {
  return apiRequest<Trip | null>('/trips/me/active')
}

export const completeH1 = (tripId: string, body: H1CompleteRequest) =>
  apiRequest<Trip>(`/trips/${tripId}/handshakes/h1/complete`, { method: 'POST', body })

export const completeH2 = (tripId: string, body: H2CompleteRequest) =>
  apiRequest<Trip>(`/trips/${tripId}/handshakes/h2/complete`, { method: 'POST', body })

export const completeH3 = (tripId: string, body: H3CompleteRequest) =>
  apiRequest<Trip>(`/trips/${tripId}/handshakes/h3/complete`, { method: 'POST', body })

export const completeH4 = (tripId: string, body: H4CompleteRequest) =>
  apiRequest<Trip>(`/trips/${tripId}/handshakes/h4/complete`, { method: 'POST', body })

export const completeH5 = (tripId: string, body: H5CompleteRequest) =>
  apiRequest<Trip>(`/trips/${tripId}/handshakes/h5/complete`, { method: 'POST', body })
```

Add the request types it imports — these mirror the backend Pydantic models from Task 10 exactly, so the two stay in lockstep:

```typescript
// frontend/shared/lib/types/handshake-requests.ts
export interface H1CompleteRequest {
  driver_phone_lat: number
  driver_phone_lng: number
  gate_photo_artifact_id: string
}

export interface H2CompleteRequest {
  waybill_photo_artifact_id: string
  seal_number: string
  seal_photo_artifact_id: string
  driver_visual_count: number
}

export interface H3CompleteRequest {
  gate_exit_photo_artifact_id: string
  guard_verified_seal: boolean
}

export interface H4CompleteRequest {
  gate_entry_photo_artifact_id: string
  seal_number_at_destination: string
}

export interface H5CompleteRequest {
  pod_photo_artifact_id: string
  driver_visual_count: number
  pp_scan_in_count: number
}
```

- [ ] **Step 2: Manifest, artifacts, exceptions, checkpoints modules**

```typescript
// frontend/driver-pwa/lib/api/manifest.ts
import { apiRequest } from './client'
import type { Linehaul } from '@shared/lib/types/manifest'

export const fetchLinehaul = (tripId: string) => apiRequest<Linehaul>(`/trips/${tripId}/manifest`)
```

```typescript
// frontend/driver-pwa/lib/api/artifacts.ts
import { getStoredToken } from './client'
import { ApiError } from './client'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1'

export interface UploadedArtifact {
  id: string
  file_hash: string
}

// Multipart upload doesn't fit apiRequest's JSON-only body — kept separate
// rather than overloading client.ts with a FormData branch nothing else needs yet.
export async function uploadArtifact(params: {
  tripId: string
  artifactType: 'photo' | 'document'
  file: Blob
  fileName: string
  capturedAt: string
  capturedLat?: number
  capturedLng?: number
}): Promise<UploadedArtifact> {
  const form = new FormData()
  form.append('trip_id', params.tripId)
  form.append('artifact_type', params.artifactType)
  form.append('captured_at', params.capturedAt)
  if (params.capturedLat !== undefined) form.append('captured_lat', String(params.capturedLat))
  if (params.capturedLng !== undefined) form.append('captured_lng', String(params.capturedLng))
  form.append('file', params.file, params.fileName)

  const token = getStoredToken()
  const response = await fetch(`${API_BASE_URL}/artifacts`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, detail.detail ?? 'Upload failed')
  }
  return response.json()
}
```

```typescript
// frontend/driver-pwa/lib/api/exceptions.ts
import { apiRequest } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'

export const raiseException = (tripId: string, body: { exception_type: ExceptionType; description: string; supporting_artifact_id?: string }) =>
  apiRequest<TripException>(`/trips/${tripId}/exceptions`, { method: 'POST', body })
```

```typescript
// frontend/driver-pwa/lib/api/checkpoints.ts
import { apiRequest } from './client'

export interface CheckpointBody {
  checkpoint_type: string
  driver_phone_lat?: number
  driver_phone_lng?: number
  selfie_artifact_id?: string
  cargo_photo_artifact_id?: string
  note?: string
  is_deviation?: boolean
}

export const logCheckpoint = (tripId: string, body: CheckpointBody) =>
  apiRequest(`/trips/${tripId}/checkpoints`, { method: 'POST', body })
```

- [ ] **Step 3: Wire `TripContext.tsx`** — replace the mock trip lookup with a real fetch, and make `logException`/`triggerPanic` hit the backend. Key diff from the current mock version:

```typescript
"use client"

import { createContext, useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import { HANDSHAKE_STEP_COUNTS, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { AuthContext } from './AuthContext'
import { fetchMyActiveTrip } from '@/lib/api/trips'
import { raiseException } from '@/lib/api/exceptions'

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  currentHandshake: HandshakeNumber
  currentStep: number
  totalSteps: number
  exceptions: TripException[]
  advance: () => void
  goBack: () => void
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  triggerPanic: () => void
  reset: () => void
  refetchTrip: () => Promise<void>
}

export const TripContext = createContext<TripState | null>(null)

function handshakeFromStatus(status: Trip['status']): HandshakeNumber {
  switch (status) {
    case 'created':          return 1
    case 'origin_gate_in':   return 1
    case 'loading':          return 2
    case 'origin_gate_out':  return 3
    case 'in_transit':       return 4
    case 'dest_gate_in':     return 4
    case 'unloading':        return 5
    default:                 return 1
  }
}

export function TripProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const authCtx = useContext(AuthContext)

  const [trip, setTrip] = useState<Trip | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentHandshake, setCurrentHandshake] = useState<HandshakeNumber>(1)
  const [currentStep, setCurrentStep] = useState(1)
  const [exceptions, setExceptions] = useState<TripException[]>([])
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  const refetchTrip = useCallback(async () => {
    if (!authCtx?.user) { setTrip(null); setIsLoading(false); return }
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      setTrip(fetched)
    } finally {
      setIsLoading(false)
    }
  }, [authCtx?.user])

  useEffect(() => { refetchTrip() }, [refetchTrip])

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setCurrentHandshake(handshakeFromStatus(trip.status))
    setCurrentStep(1)
    setExceptions(trip.exceptions)
  }

  const totalSteps = HANDSHAKE_STEP_COUNTS[currentHandshake]

  // advance()/goBack() are unchanged from the mock version — they're pure
  // client-side step navigation. The actual handshake submission (POST to the
  // backend) happens in each step screen's submit handler (Phase H), which
  // calls refetchTrip() afterward to pick up the new Trip.status before advance()
  // routes to the next handshake.
  const advance = useCallback(() => {
    if (!trip) return
    const h = currentHandshake as 1 | 2 | 3 | 4 | 5
    if (currentStep < totalSteps) {
      const next = currentStep + 1
      setCurrentStep(next)
      router.push(ROUTES.handshakeStep(String(trip.id), h, STEP_SLUGS[h][next - 1]))
      return
    }
    if (currentHandshake === 3) { router.push(ROUTES.inTransit(String(trip.id))); return }
    if (currentHandshake < 5) {
      const nextH = (currentHandshake + 1) as 1 | 2 | 3 | 4 | 5
      setCurrentHandshake(nextH)
      setCurrentStep(1)
      router.push(ROUTES.handshakeStep(String(trip.id), nextH, STEP_SLUGS[nextH][0]))
    }
  }, [trip, currentHandshake, currentStep, totalSteps, router])

  const goBack = useCallback(() => {
    if (!trip) return
    const h = currentHandshake as 1 | 2 | 3 | 4 | 5
    if (currentStep > 1) {
      const prev = currentStep - 1
      setCurrentStep(prev)
      router.push(ROUTES.handshakeStep(String(trip.id), h, STEP_SLUGS[h][prev - 1]))
      return
    }
    if (currentHandshake === 4) { router.push(ROUTES.inTransit(String(trip.id))); return }
    if (currentHandshake > 1) {
      const prevH = (currentHandshake - 1) as 1 | 2 | 3 | 4 | 5
      const prevTotal = HANDSHAKE_STEP_COUNTS[prevH]
      setCurrentHandshake(prevH)
      setCurrentStep(prevTotal)
      router.push(ROUTES.handshakeStep(String(trip.id), prevH, STEP_SLUGS[prevH][prevTotal - 1]))
    }
  }, [trip, currentHandshake, currentStep, router])

  const logException = useCallback(async (type: ExceptionType, payload: Record<string, unknown>) => {
    if (!trip) return
    const created = await raiseException(String(trip.id), {
      exception_type: type,
      description: typeof payload.description === 'string' ? payload.description : '',
      supporting_artifact_id: typeof payload.supporting_artifact_id === 'string' ? payload.supporting_artifact_id : undefined,
    })
    setExceptions(prev => [...prev, created])
  }, [trip])

  const triggerPanic = useCallback(() => {
    if (!trip) return
    router.push(ROUTES.panic(String(trip.id)))
  }, [trip, router])

  const reset = useCallback(() => {
    if (!trip) return
    setCurrentHandshake(handshakeFromStatus(trip.status))
    setCurrentStep(1)
    setExceptions(trip.exceptions)
  }, [trip])

  return (
    <TripContext.Provider
      value={{ trip, isLoading, currentHandshake, currentStep, totalSteps, exceptions, advance, goBack, logException, triggerPanic, reset, refetchTrip }}
    >
      {children}
    </TripContext.Provider>
  )
}
```

Note: `useContext` needs importing (`import { createContext, useContext, useState, useCallback, useEffect } from 'react'`) — the original file already had it; keep it.

- [ ] **Step 4: Manual verification**

Run backend (`cd backend && uvicorn app.main:app --reload`) and frontend (`cd frontend/driver-pwa && npm run dev`), sign in via OTP (check backend logs for the mock SMS code since `TWILIO_USE_MOCK=true`), and confirm the root page redirects to `/trips/{id}` once `fetchMyActiveTrip()` returns a trip.

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/lib/api/ frontend/shared/lib/types/handshake-requests.ts \
        frontend/driver-pwa/lib/context/TripContext.tsx
git commit -m "feat(trips): wire driver-pwa TripContext to real backend trip/manifest/exception/checkpoint endpoints"
```

---

# Phase G — Capture hooks

### Task 23: `useCamera` + `useSeal` hooks

**Files:**
- Create: `frontend/driver-pwa/lib/hooks/useCamera.ts`
- Create: `frontend/driver-pwa/lib/hooks/useSeal.ts`
- Modify: `frontend/driver-pwa/package.json`

- [ ] **Step 1: Add the barcode scanner dependency**

Run: `cd frontend/driver-pwa && npm install @capacitor-community/barcode-scanning@^0.1.0`

(Seal capture is photo + scanned barcode number, not NFC — no maintained Capacitor 6 NFC plugin exists with the project's stated stack; flag NFC as a stretch goal for the team rather than guessing at an unmaintained package. The design note's "door-NFC is a no-brainer" framing is about hardware ergonomics, not a hard technical requirement — barcode scan of a printed seal tag satisfies "scan, don't type.")

- [ ] **Step 2: `useCamera`**

```typescript
// frontend/driver-pwa/lib/hooks/useCamera.ts
"use client"

import { useState, useCallback } from 'react'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export interface CapturedPhoto {
  blob: Blob
  dataUrl: string
}

export type CameraStatus = 'idle' | 'capturing' | 'captured' | 'error'

export interface CameraState {
  photo: CapturedPhoto | null
  status: CameraStatus
  capture: () => Promise<void>
  retake: () => void
}

export function useCamera(): CameraState {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')

  const capture = useCallback(async () => {
    setStatus('capturing')
    try {
      const result = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 80,
        allowEditing: false,
      })
      const dataUrl = result.dataUrl!
      const blob = await (await fetch(dataUrl)).blob()
      setPhoto({ blob, dataUrl })
      setStatus('captured')
    } catch {
      setStatus('error')
    }
  }, [])

  const retake = useCallback(() => {
    setPhoto(null)
    setStatus('idle')
  }, [])

  return { photo, status, capture, retake }
}
```

- [ ] **Step 3: `useSeal`**

```typescript
// frontend/driver-pwa/lib/hooks/useSeal.ts
"use client"

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { BarcodeScanner } from '@capacitor-community/barcode-scanning'

const SEAL_FORMAT = /^[A-Z]{2}-\d{4}$/

export type SealScanStatus = 'idle' | 'scanning' | 'scanned' | 'invalid_format' | 'error'

export interface SealState {
  sealNumber: string | null
  status: SealScanStatus
  scan: () => Promise<void>
  setManual: (value: string) => void
}

export function useSeal(): SealState {
  const [sealNumber, setSealNumber] = useState<string | null>(null)
  const [status, setStatus] = useState<SealScanStatus>('idle')

  const applyValue = useCallback((value: string) => {
    const normalized = value.trim().toUpperCase()
    if (!SEAL_FORMAT.test(normalized)) {
      setStatus('invalid_format')
      setSealNumber(normalized)
      return
    }
    setSealNumber(normalized)
    setStatus('scanned')
  }, [])

  const scan = useCallback(async () => {
    setStatus('scanning')
    try {
      if (!Capacitor.isNativePlatform()) {
        // Browser dev fallback — no camera-based scanner available outside the APK.
        applyValue('AB-1234')
        return
      }
      const result = await BarcodeScanner.scan()
      if (result.barcodes.length === 0) { setStatus('error'); return }
      applyValue(result.barcodes[0].rawValue)
    } catch {
      setStatus('error')
    }
  }, [applyValue])

  const setManual = useCallback((value: string) => applyValue(value), [applyValue])

  return { sealNumber, status, scan, setManual }
}
```

- [ ] **Step 4: Manual verification**

Run: `cd frontend/driver-pwa && npm run type-check`
Expected: passes (the barcode-scanning package ships its own types).

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/lib/hooks/useCamera.ts frontend/driver-pwa/lib/hooks/useSeal.ts \
        frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json
git commit -m "feat(capture): add useCamera and useSeal hooks for evidence capture"
```

---

# Phase H — Handshake step UI (replace placeholder)

### Task 24: Shared step shell + submit gating

**Files:**
- Create: `frontend/driver-pwa/components/handshake/HandshakeStepShell.tsx`

- [ ] **Step 1: Implement the shell** — every per-handshake screen in Tasks 25–29 wraps its content in this; it owns the header (handshake/step name via `useStepIndicator`), the back button, and the gated submit button (per design note §2: "Submit" stays disabled until required evidence is captured).

```tsx
// frontend/driver-pwa/components/handshake/HandshakeStepShell.tsx
"use client"

import type { ReactNode } from 'react'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import { useStepIndicator } from '@/lib/hooks/useStepIndicator'
import { useTrip } from '@/lib/hooks/useTrip'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

interface HandshakeStepShellProps {
  handshake: HandshakeNumber
  step: number
  children: ReactNode
  canSubmit: boolean
  submitting?: boolean
  onSubmit: () => void | Promise<void>
  submitLabel?: string
}

export function HandshakeStepShell({
  handshake, step, children, canSubmit, submitting = false, onSubmit, submitLabel,
}: HandshakeStepShellProps) {
  const { handshakeName, stepName, current, total } = useStepIndicator(handshake, step)
  const { goBack } = useTrip()

  return (
    <main className="min-h-screen p-4 flex flex-col">
      <header className="mb-4">
        <button onClick={goBack} className="mb-3 text-sm text-secondary">{COPY.actions.back}</button>
        <p className="text-sm text-surface-on-variant">{handshakeName} · Step {current}/{total}</p>
        <h1 className="text-xl font-semibold">{stepName}</h1>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="pt-4">
        <Button
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onClick={onSubmit}
        >
          {submitLabel ?? COPY.actions.completeAndContinue}
        </Button>
      </footer>
    </main>
  )
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend/driver-pwa && npm run type-check`

- [ ] **Step 3: Commit**

```bash
git add frontend/driver-pwa/components/handshake/HandshakeStepShell.tsx
git commit -m "feat(handshake-ui): add shared step shell with gated submit"
```

---

### Task 25: H1 — Origin Gate-In screens

**Files:**
- Create: `frontend/driver-pwa/components/handshake/h1/GateArrivalStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h1/EntryPhotoStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h1/VerificationStep.tsx`
- Modify: `frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx`

- [ ] **Step 1: Step 1 — Gate Arrival (GPS auto-capture, zero taps)**

```tsx
// frontend/driver-pwa/components/handshake/h1/GateArrivalStep.tsx
"use client"

import { useEffect } from 'react'
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

export function GateArrivalStep() {
  const { coords, status, capture } = useLocation()
  const { advance } = useTrip()

  useEffect(() => { capture() }, [capture])

  return (
    <HandshakeStepShell
      handshake={1} step={1}
      canSubmit={status === 'captured'}
      onSubmit={advance}
    >
      <Card>
        {status === 'capturing' && <Spinner />}
        {status === 'captured' && coords && (
          <p className="text-sm">GPS locked · {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</p>
        )}
        {status === 'error' && <p className="text-sm text-error">Could not get GPS — check location permissions and retry.</p>}
      </Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 2: Step 2 — Entry Photo (camera + upload, holds the artifact ID for the H1 submit)**

```tsx
// frontend/driver-pwa/components/handshake/h1/EntryPhotoStep.tsx
"use client"

import { useState } from 'react'
import { useCamera } from '@/lib/hooks/useCamera'
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { uploadArtifact } from '@/lib/api/artifacts'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

export function EntryPhotoStep() {
  const { photo, status, capture, retake } = useCamera()
  const { coords } = useLocation()
  const { trip, advance } = useTrip()
  const [uploading, setUploading] = useState(false)

  const handleSubmit = async () => {
    if (!photo || !trip) return
    setUploading(true)
    try {
      await uploadArtifact({
        tripId: String(trip.id), artifactType: 'photo', file: photo.blob,
        fileName: 'h1-entry.jpg', capturedAt: new Date().toISOString(),
        capturedLat: coords?.latitude, capturedLng: coords?.longitude,
      })
      advance()
    } finally {
      setUploading(false)
    }
  }

  return (
    <HandshakeStepShell handshake={1} step={2} canSubmit={status === 'captured'} submitting={uploading} onSubmit={handleSubmit}>
      {status !== 'captured' ? (
        <Button size="lg" onClick={capture}>Take entry photo</Button>
      ) : (
        <div className="space-y-3">
          <img src={photo!.dataUrl} alt="Gate entry" className="rounded-xl w-full" />
          <Button variant="secondary" onClick={retake}>{COPY.actions.retakePhoto}</Button>
        </div>
      )}
    </HandshakeStepShell>
  )
}
```

The uploaded artifact ID needs to reach the H1 submit (Step 3, "Verification") — store it in `TripContext`-adjacent local state is wrong (it's per-handshake transient data, not trip-wide). Add a small per-handshake draft store instead:

```typescript
// frontend/driver-pwa/lib/hooks/useHandshakeDraft.ts
"use client"

import { useState, useCallback } from 'react'

// Holds artifact IDs / form fields captured across a handshake's steps until
// the final step's submit assembles the full CompleteRequest. Cleared on advance
// past the handshake (TripContext's setCurrentStep(1) on handshake change makes
// staleness harmless even without explicit clearing).
export function useHandshakeDraft<T extends Record<string, unknown>>(initial: T) {
  const [draft, setDraft] = useState<T>(initial)
  const patch = useCallback((partial: Partial<T>) => setDraft(prev => ({ ...prev, ...partial })), [])
  return { draft, patch }
}
```

Revise `EntryPhotoStep` to call `patch({ gatePhotoArtifactId: result.id })` from a draft instance lifted into the route page (Step 4 below), rather than holding it locally — components don't share state otherwise.

- [ ] **Step 3: Step 3 — Verification (assembles H1CompleteRequest, submits)**

```tsx
// frontend/driver-pwa/components/handshake/h1/VerificationStep.tsx
"use client"

import { useState } from 'react'
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { completeH1 } from '@/lib/api/trips'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { COPY } from '@shared/lib/constants/copy'

interface VerificationStepProps {
  gatePhotoArtifactId: string | null
}

export function VerificationStep({ gatePhotoArtifactId }: VerificationStepProps) {
  const { coords } = useLocation()
  const { trip, refetchTrip, advance } = useTrip()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!trip || !coords || !gatePhotoArtifactId) return
    setSubmitting(true)
    try {
      await completeH1(String(trip.id), {
        driver_phone_lat: coords.latitude,
        driver_phone_lng: coords.longitude,
        gate_photo_artifact_id: gatePhotoArtifactId,
      })
      await refetchTrip()
      advance()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HandshakeStepShell
      handshake={1} step={3}
      canSubmit={Boolean(coords && gatePhotoArtifactId)}
      submitting={submitting}
      onSubmit={handleSubmit}
      submitLabel={COPY.actions.completeAndContinue}
    >
      <Card>
        <p className="text-sm">Ready to log origin gate-in. GPS and entry photo captured.</p>
      </Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 4: Route the step page** — replace the placeholder body in `app/trips/[id]/handshake/[step]/page.tsx`. The route needs to lift the draft so `EntryPhotoStep` and `VerificationStep` share `gatePhotoArtifactId` — since both H1's steps and H2–H5's steps all need this pattern, the route page becomes a per-handshake switch:

```tsx
'use client'

import { useParams } from 'next/navigation'
import { useTrip } from '@/lib/hooks/useTrip'
import { useHandshakeDraft } from '@/lib/hooks/useHandshakeDraft'
import { GateArrivalStep } from '@/components/handshake/h1/GateArrivalStep'
import { EntryPhotoStep } from '@/components/handshake/h1/EntryPhotoStep'
import { VerificationStep } from '@/components/handshake/h1/VerificationStep'

interface H1Draft {
  gatePhotoArtifactId: string | null
}

export default function HandshakeStepPage() {
  const { step } = useParams<{ id: string; step: string }>()
  const { currentHandshake } = useTrip()
  const { draft, patch } = useHandshakeDraft<H1Draft>({ gatePhotoArtifactId: null })

  if (currentHandshake === 1) {
    if (step === '1-approach-gate') return <GateArrivalStep />
    if (step === '2-entry-photo') return <EntryPhotoStep onCaptured={(id) => patch({ gatePhotoArtifactId: id })} />
    if (step === '3-verification') return <VerificationStep gatePhotoArtifactId={draft.gatePhotoArtifactId} />
  }

  // H2-H5 switches are added in Tasks 26-29, following the exact same pattern.
  return <main className="p-4">Unhandled step: {step}</main>
}
```

`EntryPhotoStep` needs an `onCaptured` prop wired to the upload result — go back and add `onCaptured: (artifactId: string) => void` to its props and call it with `result.id` instead of (or in addition to) advancing directly; have it call `onCaptured(result.id)` then `advance()`.

- [ ] **Step 5: Manual verification**

Run: `cd frontend/driver-pwa && npm run dev` — walk a seeded trip at `created` status through all three H1 steps in the browser (camera capture falls back to a file picker in non-native browser testing, per Capacitor's web implementation).

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/components/handshake/h1/ frontend/driver-pwa/lib/hooks/useHandshakeDraft.ts \
        "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
git commit -m "feat(handshake-ui): implement H1 Origin Gate-In step screens"
```

---

### Task 26: H2 — Loading screens (Linehaul review, waybill, seal, review)

**Files:**
- Create: `frontend/driver-pwa/components/handshake/h2/ArriveBayStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h2/LinehaulStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h2/WaybillStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h2/SealStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h2/ReviewStep.tsx`
- Modify: `frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx`

This is the handshake the Ciaran note is specifically about — `LinehaulStep` must show **only** vehicle/driver/consolidated-unit-count, never per-parcel data.

- [ ] **Step 1: `ArriveBayStep`** — same GPS-auto-capture pattern as H1 Step 1, reused directly:

```tsx
// frontend/driver-pwa/components/handshake/h2/ArriveBayStep.tsx
"use client"

import { useEffect } from 'react'
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

export function ArriveBayStep() {
  const { status, capture } = useLocation()
  const { advance } = useTrip()
  useEffect(() => { capture() }, [capture])

  return (
    <HandshakeStepShell handshake={2} step={1} canSubmit={status === 'captured'} onSubmit={advance}>
      <Card>{status === 'capturing' ? <Spinner /> : <p className="text-sm">Arrived at loading bay.</p>}</Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 2: `LinehaulStep`** — fetches and displays the Linehaul document, nothing per-parcel:

```tsx
// frontend/driver-pwa/components/handshake/h2/LinehaulStep.tsx
"use client"

import { useEffect, useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { fetchLinehaul } from '@/lib/api/manifest'
import type { Linehaul } from '@shared/lib/types/manifest'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

export function LinehaulStep() {
  const { trip, advance } = useTrip()
  const [linehaul, setLinehaul] = useState<Linehaul | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!trip) return
    fetchLinehaul(String(trip.id)).then(setLinehaul).finally(() => setLoading(false))
  }, [trip])

  return (
    <HandshakeStepShell handshake={2} step={2} canSubmit={Boolean(linehaul)} onSubmit={advance}>
      {loading ? <Spinner /> : linehaul && (
        <Card>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Vehicle</dt><dd>{linehaul.vehicle_registration}</dd></div>
            <div className="flex justify-between"><dt>Driver</dt><dd>{linehaul.driver_full_name}</dd></div>
            <div className="flex justify-between"><dt>Consolidated units</dt><dd className="font-bold">{linehaul.consolidated_unit_count}</dd></div>
          </dl>
        </Card>
      )}
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 3: `WaybillStep`** — photo capture + upload, same shape as H1's `EntryPhotoStep`:

```tsx
// frontend/driver-pwa/components/handshake/h2/WaybillStep.tsx
"use client"

import { useState } from 'react'
import { useCamera } from '@/lib/hooks/useCamera'
import { useTrip } from '@/lib/hooks/useTrip'
import { uploadArtifact } from '@/lib/api/artifacts'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

interface WaybillStepProps {
  onCaptured: (artifactId: string) => void
}

export function WaybillStep({ onCaptured }: WaybillStepProps) {
  const { photo, status, capture, retake } = useCamera()
  const { trip, advance } = useTrip()
  const [uploading, setUploading] = useState(false)

  const handleSubmit = async () => {
    if (!photo || !trip) return
    setUploading(true)
    try {
      const result = await uploadArtifact({
        tripId: String(trip.id), artifactType: 'photo', file: photo.blob,
        fileName: 'h2-waybill.jpg', capturedAt: new Date().toISOString(),
      })
      onCaptured(result.id)
      advance()
    } finally {
      setUploading(false)
    }
  }

  return (
    <HandshakeStepShell handshake={2} step={3} canSubmit={status === 'captured'} submitting={uploading} onSubmit={handleSubmit}>
      {status !== 'captured' ? (
        <Button size="lg" onClick={capture}>Photograph waybill</Button>
      ) : (
        <div className="space-y-3">
          <img src={photo!.dataUrl} alt="Waybill" className="rounded-xl w-full" />
          <Button variant="secondary" onClick={retake}>{COPY.actions.retakePhoto}</Button>
        </div>
      )}
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 4: `SealStep`** — scan + photo, inline mismatch-format validation (per design note §2: flag immediately, don't let bad data through):

```tsx
// frontend/driver-pwa/components/handshake/h2/SealStep.tsx
"use client"

import { useState } from 'react'
import { useSeal } from '@/lib/hooks/useSeal'
import { useCamera } from '@/lib/hooks/useCamera'
import { useTrip } from '@/lib/hooks/useTrip'
import { uploadArtifact } from '@/lib/api/artifacts'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

interface SealStepProps {
  onCaptured: (sealNumber: string, sealPhotoArtifactId: string) => void
}

export function SealStep({ onCaptured }: SealStepProps) {
  const { sealNumber, status: sealStatus, scan } = useSeal()
  const { photo, status: photoStatus, capture, retake } = useCamera()
  const { trip, advance } = useTrip()
  const [uploading, setUploading] = useState(false)

  const canSubmit = sealStatus === 'scanned' && photoStatus === 'captured'

  const handleSubmit = async () => {
    if (!canSubmit || !photo || !sealNumber || !trip) return
    setUploading(true)
    try {
      const result = await uploadArtifact({
        tripId: String(trip.id), artifactType: 'photo', file: photo.blob,
        fileName: 'h2-seal.jpg', capturedAt: new Date().toISOString(),
      })
      onCaptured(sealNumber, result.id)
      advance()
    } finally {
      setUploading(false)
    }
  }

  return (
    <HandshakeStepShell handshake={2} step={4} canSubmit={canSubmit} submitting={uploading} onSubmit={handleSubmit}>
      <div className="space-y-4">
        <Button onClick={scan}>{sealNumber ? `Seal: ${sealNumber}` : 'Scan seal'}</Button>
        {sealStatus === 'invalid_format' && <p className="text-sm text-error">{COPY.errors.sealFormat}</p>}
        {photoStatus !== 'captured' ? (
          <Button onClick={capture}>Photograph seal</Button>
        ) : (
          <div className="space-y-3">
            <img src={photo!.dataUrl} alt="Seal" className="rounded-xl w-full" />
            <Button variant="secondary" onClick={retake}>{COPY.actions.retakePhoto}</Button>
          </div>
        )}
      </div>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 5: `ReviewStep`** — assembles `H2CompleteRequest` and submits:

```tsx
// frontend/driver-pwa/components/handshake/h2/ReviewStep.tsx
"use client"

import { useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { completeH2 } from '@/lib/api/trips'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'

interface ReviewStepProps {
  waybillPhotoArtifactId: string | null
  sealNumber: string | null
  sealPhotoArtifactId: string | null
  driverVisualCount: number | null
}

export function ReviewStep({ waybillPhotoArtifactId, sealNumber, sealPhotoArtifactId, driverVisualCount }: ReviewStepProps) {
  const { trip, refetchTrip, advance } = useTrip()
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = Boolean(waybillPhotoArtifactId && sealNumber && sealPhotoArtifactId && driverVisualCount !== null)

  const handleSubmit = async () => {
    if (!canSubmit || !trip) return
    setSubmitting(true)
    try {
      await completeH2(String(trip.id), {
        waybill_photo_artifact_id: waybillPhotoArtifactId!,
        seal_number: sealNumber!,
        seal_photo_artifact_id: sealPhotoArtifactId!,
        driver_visual_count: driverVisualCount!,
      })
      await refetchTrip()
      advance()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HandshakeStepShell handshake={2} step={5} canSubmit={canSubmit} submitting={submitting} onSubmit={handleSubmit}>
      <Card>
        <p className="text-sm">Seal {sealNumber} captured. Confirm to log loading complete.</p>
      </Card>
    </HandshakeStepShell>
  )
}
```

`driver_visual_count` needs a tap-confirm UI (per design note §2: "Counts confirmed by tap... Typing is the enemy") — add a count-stepper to `ReviewStep` defaulting to `linehaul.consolidated_unit_count` (passed down from the route page's draft, sourced from `LinehaulStep`'s fetch) with +/- buttons, not a text input. Wire its `onChange` into the route page's draft `patch({ driverVisualCount })`.

- [ ] **Step 6: Extend the route page's H2 switch** — in `app/trips/[id]/handshake/[step]/page.tsx`, add:

```tsx
interface H2Draft {
  waybillPhotoArtifactId: string | null
  sealNumber: string | null
  sealPhotoArtifactId: string | null
  driverVisualCount: number | null
}
// ... lifted alongside H1Draft using the same useHandshakeDraft pattern

if (currentHandshake === 2) {
  if (step === '1-arrive-bay') return <ArriveBayStep />
  if (step === '2-linehaul') return <LinehaulStep />
  if (step === '3-waybill') return <WaybillStep onCaptured={(id) => patchH2({ waybillPhotoArtifactId: id })} />
  if (step === '4-seal') return <SealStep onCaptured={(seal, id) => patchH2({ sealNumber: seal, sealPhotoArtifactId: id })} />
  if (step === '5-review') return <ReviewStep {...h2Draft} />
}
```

- [ ] **Step 7: Manual verification**

Run: `cd frontend/driver-pwa && npm run dev` — walk a trip at `origin_gate_in` through all 5 H2 steps; confirm the Linehaul screen shows no per-parcel list.

- [ ] **Step 8: Commit**

```bash
git add frontend/driver-pwa/components/handshake/h2/ "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
git commit -m "feat(handshake-ui): implement H2 Loading step screens with Linehaul review"
```

---

### Task 27: H3 — Origin Gate-Out screens

**Files:**
- Create: `frontend/driver-pwa/components/handshake/h3/ApproachExitStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h3/ExitPhotoSealStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h3/DepartureStep.tsx`
- Modify: route page

- [ ] **Step 1–3: same three-step pattern as H1** (GPS-auto step → photo+confirm step → submit step), parameterized for H3's fields:

```tsx
// frontend/driver-pwa/components/handshake/h3/ApproachExitStep.tsx
"use client"
import { useEffect } from 'react'
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

export function ApproachExitStep() {
  const { status, capture } = useLocation()
  const { advance } = useTrip()
  useEffect(() => { capture() }, [capture])
  return (
    <HandshakeStepShell handshake={3} step={1} canSubmit={status === 'captured'} onSubmit={advance}>
      <Card>{status === 'capturing' ? <Spinner /> : <p className="text-sm">Approaching exit gate.</p>}</Card>
    </HandshakeStepShell>
  )
}
```

```tsx
// frontend/driver-pwa/components/handshake/h3/ExitPhotoSealStep.tsx
"use client"
import { useState } from 'react'
import { useCamera } from '@/lib/hooks/useCamera'
import { useTrip } from '@/lib/hooks/useTrip'
import { uploadArtifact } from '@/lib/api/artifacts'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

interface ExitPhotoSealStepProps {
  onCaptured: (artifactId: string) => void
}

export function ExitPhotoSealStep({ onCaptured }: ExitPhotoSealStepProps) {
  const { photo, status, capture, retake } = useCamera()
  const { trip, advance } = useTrip()
  const [uploading, setUploading] = useState(false)

  const handleSubmit = async () => {
    if (!photo || !trip) return
    setUploading(true)
    try {
      const result = await uploadArtifact({
        tripId: String(trip.id), artifactType: 'photo', file: photo.blob,
        fileName: 'h3-exit-seal.jpg', capturedAt: new Date().toISOString(),
      })
      onCaptured(result.id)
      advance()
    } finally {
      setUploading(false)
    }
  }

  return (
    <HandshakeStepShell handshake={3} step={2} canSubmit={status === 'captured'} submitting={uploading} onSubmit={handleSubmit}>
      {status !== 'captured' ? (
        <Button size="lg" onClick={capture}>Photograph seal at exit</Button>
      ) : (
        <div className="space-y-3">
          <img src={photo!.dataUrl} alt="Exit seal" className="rounded-xl w-full" />
          <Button variant="secondary" onClick={retake}>{COPY.actions.retakePhoto}</Button>
        </div>
      )}
    </HandshakeStepShell>
  )
}
```

```tsx
// frontend/driver-pwa/components/handshake/h3/DepartureStep.tsx
"use client"
import { useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { completeH3 } from '@/lib/api/trips'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'

interface DepartureStepProps {
  gateExitPhotoArtifactId: string | null
}

export function DepartureStep({ gateExitPhotoArtifactId }: DepartureStepProps) {
  const { trip, refetchTrip, advance } = useTrip()
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = Boolean(gateExitPhotoArtifactId)

  const handleSubmit = async () => {
    if (!canSubmit || !trip) return
    setSubmitting(true)
    try {
      await completeH3(String(trip.id), {
        gate_exit_photo_artifact_id: gateExitPhotoArtifactId!,
        guard_verified_seal: true,
      })
      await refetchTrip()
      advance()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HandshakeStepShell handshake={3} step={3} canSubmit={canSubmit} submitting={submitting} onSubmit={handleSubmit}>
      <Card><p className="text-sm">Ready to depart origin.</p></Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 4: Extend route page**, mirroring H2's pattern (`1-approach-exit` → `2-exit-and-seal` → `3-departure`).

- [ ] **Step 5: Manual verification + commit**

```bash
git add frontend/driver-pwa/components/handshake/h3/ "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
git commit -m "feat(handshake-ui): implement H3 Origin Gate-Out step screens"
```

---

### Task 28: H4 — Destination Gate-In screens (seal-mismatch UX)

**Files:**
- Create: `frontend/driver-pwa/components/handshake/h4/DestGateArrivalStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h4/DestEntryPhotoStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h4/SealVerifyStep.tsx`
- Modify: route page

H4's distinct behaviour: `advance_h4` always returns 200, even on mismatch (per contract — the trip continues under `exception_hold`). The UI must surface that, not treat it as a failed request.

- [ ] **Step 1–2: Gate arrival + entry photo** — identical pattern to H1/H3 (GPS-auto, then photo+upload), parameterized for H4.

- [ ] **Step 3: `SealVerifyStep`** — scans the destination seal and submits `H4CompleteRequest`, then branches UI on the resulting trip status:

```tsx
// frontend/driver-pwa/components/handshake/h4/SealVerifyStep.tsx
"use client"

import { useState } from 'react'
import { useSeal } from '@/lib/hooks/useSeal'
import { useTrip } from '@/lib/hooks/useTrip'
import { completeH4 } from '@/lib/api/trips'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'

interface SealVerifyStepProps {
  gateEntryPhotoArtifactId: string | null
}

export function SealVerifyStep({ gateEntryPhotoArtifactId }: SealVerifyStepProps) {
  const { sealNumber, status: sealStatus, scan } = useSeal()
  const { trip, refetchTrip, advance } = useTrip()
  const [submitting, setSubmitting] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  const canSubmit = sealStatus === 'scanned' && Boolean(gateEntryPhotoArtifactId)

  const handleSubmit = async () => {
    if (!canSubmit || !trip) return
    setSubmitting(true)
    try {
      const updated = await completeH4(String(trip.id), {
        gate_entry_photo_artifact_id: gateEntryPhotoArtifactId!,
        seal_number_at_destination: sealNumber!,
      })
      await refetchTrip()
      if (updated.status === 'exception_hold') {
        setMismatch(true)
        return
      }
      advance()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HandshakeStepShell handshake={4} step={3} canSubmit={canSubmit && !mismatch} submitting={submitting} onSubmit={handleSubmit}>
      <Card>
        <Button onClick={scan}>{sealNumber ? `Seal: ${sealNumber}` : 'Scan destination seal'}</Button>
        {mismatch && (
          <div className="mt-4 space-y-2">
            <Chip kind="error">Seal mismatch</Chip>
            <p className="text-sm">
              This doesn&apos;t match the seal logged at loading. The trip is on hold —
              dispatch has been alerted. Wait for further instructions.
            </p>
          </div>
        )}
      </Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 4: Extend route page** (`1-approach-dest` → `2-dest-entry-photo` → `3-seal-verify`).

- [ ] **Step 5: Manual verification + commit**

Verify both paths: matching destination seal advances to H5; a deliberately wrong seal shows the mismatch `Chip` and does not advance.

```bash
git add frontend/driver-pwa/components/handshake/h4/ "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
git commit -m "feat(handshake-ui): implement H4 Destination Gate-In with seal-mismatch UX"
```

---

### Task 29: H5 — Unloading screens + trip closed

**Files:**
- Create: `frontend/driver-pwa/components/handshake/h5/HandWaybillStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h5/InspectionWaitStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h5/VisualCountStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h5/PodPhotoStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h5/ReconciliationStep.tsx`
- Create: `frontend/driver-pwa/components/handshake/h5/TripClosedStep.tsx`
- Modify: route page

- [ ] **Step 1: `HandWaybillStep`** — a confirmation tap, no capture (driver physically hands a paper copy to the receiver):

```tsx
// frontend/driver-pwa/components/handshake/h5/HandWaybillStep.tsx
"use client"
import { useTrip } from '@/lib/hooks/useTrip'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'

export function HandWaybillStep() {
  const { advance } = useTrip()
  return (
    <HandshakeStepShell handshake={5} step={1} canSubmit={true} onSubmit={advance} submitLabel="Waybill handed over">
      <Card><p className="text-sm">Hand the printed waybill copy to the receiver, then continue.</p></Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 2: `InspectionWaitStep`** — polls `GET /trips/{id}/handshakes/unloading` every 4s per the contract's §3.4 polling use case:

```tsx
// frontend/driver-pwa/components/handshake/h5/InspectionWaitStep.tsx
"use client"

import { useEffect, useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { apiRequest } from '@/lib/api/client'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

interface HandshakeEventLite {
  status: string
  parcel_count_destination: number | null
}

export function InspectionWaitStep() {
  const { trip, advance } = useTrip()
  const [scanInCount, setScanInCount] = useState<number | null>(null)

  useEffect(() => {
    if (!trip) return
    let cancelled = false
    const poll = async () => {
      const event = await apiRequest<HandshakeEventLite>(`/trips/${trip.id}/handshakes/unloading`)
      if (!cancelled) setScanInCount(event.parcel_count_destination)
    }
    poll()
    const interval = setInterval(poll, 4000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [trip])

  return (
    <HandshakeStepShell handshake={5} step={2} canSubmit={scanInCount !== null} onSubmit={advance}>
      <Card>
        {scanInCount === null ? <Spinner /> : <p className="text-sm">Scan-in count so far: {scanInCount}</p>}
      </Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 3: `VisualCountStep`** — tap-stepper, not typed input (design note §2):

```tsx
// frontend/driver-pwa/components/handshake/h5/VisualCountStep.tsx
"use client"
import { useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface VisualCountStepProps {
  onConfirmed: (count: number) => void
}

export function VisualCountStep({ onConfirmed }: VisualCountStepProps) {
  const { advance } = useTrip()
  const [count, setCount] = useState(0)

  const handleSubmit = () => { onConfirmed(count); advance() }

  return (
    <HandshakeStepShell handshake={5} step={3} canSubmit={count > 0} onSubmit={handleSubmit}>
      <Card>
        <div className="flex items-center justify-center gap-6">
          <Button variant="secondary" onClick={() => setCount(c => Math.max(0, c - 1))}>-</Button>
          <span className="text-3xl font-bold">{count}</span>
          <Button variant="secondary" onClick={() => setCount(c => c + 1)}>+</Button>
        </div>
      </Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 4: `PodPhotoStep`** — same photo+upload pattern as earlier steps, captures `pod_photo_artifact_id`.

```tsx
// frontend/driver-pwa/components/handshake/h5/PodPhotoStep.tsx
"use client"
import { useState } from 'react'
import { useCamera } from '@/lib/hooks/useCamera'
import { useTrip } from '@/lib/hooks/useTrip'
import { uploadArtifact } from '@/lib/api/artifacts'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Button } from '@/components/ui/Button'
import { COPY } from '@shared/lib/constants/copy'

interface PodPhotoStepProps {
  onCaptured: (artifactId: string) => void
}

export function PodPhotoStep({ onCaptured }: PodPhotoStepProps) {
  const { photo, status, capture, retake } = useCamera()
  const { trip, advance } = useTrip()
  const [uploading, setUploading] = useState(false)

  const handleSubmit = async () => {
    if (!photo || !trip) return
    setUploading(true)
    try {
      const result = await uploadArtifact({
        tripId: String(trip.id), artifactType: 'photo', file: photo.blob,
        fileName: 'h5-pod.jpg', capturedAt: new Date().toISOString(),
      })
      onCaptured(result.id)
      advance()
    } finally {
      setUploading(false)
    }
  }

  return (
    <HandshakeStepShell handshake={5} step={4} canSubmit={status === 'captured'} submitting={uploading} onSubmit={handleSubmit}>
      {status !== 'captured' ? (
        <Button size="lg" onClick={capture}>Photograph proof of delivery</Button>
      ) : (
        <div className="space-y-3">
          <img src={photo!.dataUrl} alt="POD" className="rounded-xl w-full" />
          <Button variant="secondary" onClick={retake}>{COPY.actions.retakePhoto}</Button>
        </div>
      )}
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 5: `ReconciliationStep`** — submits `H5CompleteRequest`:

```tsx
// frontend/driver-pwa/components/handshake/h5/ReconciliationStep.tsx
"use client"
import { useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { completeH5 } from '@/lib/api/trips'
import { HandshakeStepShell } from '@/components/handshake/HandshakeStepShell'
import { Card } from '@/components/ui/Card'

interface ReconciliationStepProps {
  podPhotoArtifactId: string | null
  driverVisualCount: number | null
  ppScanInCount: number | null
}

export function ReconciliationStep({ podPhotoArtifactId, driverVisualCount, ppScanInCount }: ReconciliationStepProps) {
  const { trip, refetchTrip, advance } = useTrip()
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = Boolean(podPhotoArtifactId && driverVisualCount !== null && ppScanInCount !== null)

  const handleSubmit = async () => {
    if (!canSubmit || !trip) return
    setSubmitting(true)
    try {
      await completeH5(String(trip.id), {
        pod_photo_artifact_id: podPhotoArtifactId!,
        driver_visual_count: driverVisualCount!,
        pp_scan_in_count: ppScanInCount!,
      })
      await refetchTrip()
      advance()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HandshakeStepShell handshake={5} step={5} canSubmit={canSubmit} submitting={submitting} onSubmit={handleSubmit}>
      <Card><p className="text-sm">Confirm delivery to close the trip.</p></Card>
    </HandshakeStepShell>
  )
}
```

- [ ] **Step 6: `TripClosedStep`** — terminal screen, routes home (this is the H5 step 6 case `TripContext.advance()` already special-cases with "handles its own navigation"):

```tsx
// frontend/driver-pwa/components/handshake/h5/TripClosedStep.tsx
"use client"
import { useRouter } from 'next/navigation'
import { useTrip } from '@/lib/hooks/useTrip'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { COPY } from '@shared/lib/constants/copy'

export function TripClosedStep() {
  const router = useRouter()
  const { trip, reset } = useTrip()

  return (
    <main className="min-h-screen p-4 flex flex-col items-center justify-center text-center gap-4">
      <Card>
        <p className="text-lg font-semibold">Trip {trip?.trip_reference} closed</p>
        <p className="text-sm text-surface-on-variant mt-2">Evidence chain complete.</p>
      </Card>
      <Button onClick={() => { reset(); router.replace('/trips') }}>{COPY.actions.returnHome}</Button>
    </main>
  )
}
```

- [ ] **Step 7: Extend the route page's H5 switch**, lifting `H5Draft { driverVisualCount, podPhotoArtifactId }` the same way H2's draft works, plus an explicit `'6-closed'` case returning `<TripClosedStep />`.

- [ ] **Step 8: Manual verification**

Walk a trip from `dest_gate_in` through all 6 H5 steps; confirm `TripClosedStep` renders and "Return home" routes to `/trips` with `TripContext` reset.

- [ ] **Step 9: Commit**

```bash
git add frontend/driver-pwa/components/handshake/h5/ "frontend/driver-pwa/app/trips/[id]/handshake/[step]/page.tsx"
git commit -m "feat(handshake-ui): implement H5 Unloading step screens and trip-closed screen"
```

---

# Phase I — Offline queue (FP-70)

### Task 30: IndexedDB evidence queue + sync-on-reconnect

**Files:**
- Create: `frontend/driver-pwa/lib/offline/queue.ts`
- Modify: `frontend/driver-pwa/lib/api/client.ts`
- Modify: `frontend/driver-pwa/lib/api/artifacts.ts`
- Modify: `frontend/driver-pwa/app/sw.ts`

Per the design note: "Queue evidence locally, sync on reconnect... the app must never block waiting on signal." Scope: artifact uploads and handshake-complete POSTs are queued when offline; GETs (trip detail, linehaul, polling) are not queued — they simply fail visibly with the existing `COPY.errors.networkOffline` message, since there's nothing useful to "sync" for a read.

- [ ] **Step 1: Install a small IndexedDB wrapper**

Run: `cd frontend/driver-pwa && npm install idb-keyval@^6.2.1`

- [ ] **Step 2: Implement the queue**

```typescript
// frontend/driver-pwa/lib/offline/queue.ts
"use client"

import { get, set, update } from 'idb-keyval'

export interface QueuedRequest {
  id: string
  url: string
  method: 'POST'
  body: FormData | Record<string, unknown>
  isFormData: boolean
  createdAt: string
}

const QUEUE_KEY = 'fp_offline_queue'

export async function enqueue(request: Omit<QueuedRequest, 'id' | 'createdAt'>): Promise<string> {
  const id = crypto.randomUUID()
  const entry: QueuedRequest = { ...request, id, createdAt: new Date().toISOString() }
  await update<QueuedRequest[]>(QUEUE_KEY, (existing) => [...(existing ?? []), entry])
  return id
}

export async function getQueue(): Promise<QueuedRequest[]> {
  return (await get<QueuedRequest[]>(QUEUE_KEY)) ?? []
}

export async function removeFromQueue(id: string): Promise<void> {
  await update<QueuedRequest[]>(QUEUE_KEY, (existing) => (existing ?? []).filter(r => r.id !== id))
}

// Call once on app mount and on every 'online' event. Best-effort — a failure
// mid-flush leaves the remaining entries queued for the next trigger rather
// than losing them.
export async function flushQueue(sendFn: (req: QueuedRequest) => Promise<void>): Promise<void> {
  const queue = await getQueue()
  for (const request of queue) {
    try {
      await sendFn(request)
      await removeFromQueue(request.id)
    } catch {
      // Stop at the first failure — preserves ordering and avoids hammering
      // a still-down backend with the rest of the queue.
      return
    }
  }
}
```

- [ ] **Step 3: Wire `uploadArtifact` to queue when offline**

```typescript
// frontend/driver-pwa/lib/api/artifacts.ts — add near the top
import { enqueue } from '@/lib/offline/queue'

// ... inside uploadArtifact, wrap the fetch:
export async function uploadArtifact(params: {/* unchanged */}): Promise<UploadedArtifact> {
  const form = new FormData()
  // ... unchanged FormData assembly ...

  if (!navigator.onLine) {
    const queueId = await enqueue({ url: `${API_BASE_URL}/artifacts`, method: 'POST', body: form, isFormData: true })
    // Caller can't get a real artifact ID yet — return a queue-local placeholder
    // so the step screen can still advance optimistically. The handshake-complete
    // submit (Phase H) re-checks queue status before its own POST; see Step 4.
    return { id: `queued:${queueId}`, file_hash: '' }
  }

  // ... existing fetch logic unchanged ...
}
```

- [ ] **Step 4: Flush on reconnect** — register in the root layout:

```tsx
// frontend/driver-pwa/app/layout.tsx — add inside the existing client providers tree
"use client"
import { useEffect } from 'react'
import { flushQueue } from '@/lib/offline/queue'
import { getStoredToken } from '@/lib/api/client'
import type { QueuedRequest } from '@/lib/offline/queue'

function OfflineQueueFlusher() {
  useEffect(() => {
    const send = async (req: QueuedRequest) => {
      const token = getStoredToken()
      await fetch(req.url, {
        method: req.method,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: req.body as FormData,
      })
    }
    const onOnline = () => { flushQueue(send) }
    window.addEventListener('online', onOnline)
    flushQueue(send) // also try once on mount, in case reconnect happened before this listener attached
    return () => window.removeEventListener('online', onOnline)
  }, [])
  return null
}
```

Mount `<OfflineQueueFlusher />` once, inside the existing provider tree in `app/layout.tsx`.

**Known limitation to flag, not hide:** the "queued:" placeholder artifact ID means a step screen that queued offline cannot immediately chain into the handshake-complete POST (it needs a real artifact ID first). For Iteration 2, the simplest correct behavior is: if any artifact in the current handshake's draft has a `queued:` ID, disable the final step's submit and show "Waiting to sync — reconnect to continue" instead of letting the handshake-complete POST go out with a fake ID. Wire this check into each handshake's final review/reconciliation step (`ReviewStep`, `VerificationStep`, etc. from Phase H) as a follow-up — not implemented in this task to avoid further inflating an already-large plan; flagged here explicitly rather than silently dropped.

- [ ] **Step 5: Manual verification**

In Chrome DevTools, toggle "Offline" in the Network tab, capture a photo in any step, confirm `navigator.onLine` is false and the artifact gets queued (inspect IndexedDB → `keyval-store` → `fp_offline_queue`); toggle back online and confirm the queue drains.

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/lib/offline/queue.ts frontend/driver-pwa/lib/api/artifacts.ts \
        frontend/driver-pwa/app/layout.tsx frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json
git commit -m "feat(offline): queue evidence uploads when offline, flush on reconnect"
```

---

## Self-review notes (per writing-plans skill)

- **Spec coverage:** every item from the original 8-step roadmap is covered — Linehaul rename (Phase E), placeholder UI replacement (Phase H), seal/camera capture (Phase G), submit gating + exception routing (Tasks 24, 26 SealStep, 28 SealVerifyStep), backend handshake endpoint (Phase C), mock→real API swap (Phase F), offline queue (Phase I). Hedera anchoring is explicitly deferred per the user's instruction (flagged in Phase C task docstrings, not silently dropped).
- **Known scope cuts, flagged rather than hidden:** dispatcher-side exception list/resolve/override endpoints (contract §3.6) are not built — only the driver-raise path needed for "driver-pwa functional." NFC seal capture uses barcode scan instead — no maintained Capacitor 6 NFC plugin exists. The offline-queue/handshake-submit interaction (Step 4 of Task 30) is flagged as a known follow-up, not implemented, to keep this plan's scope bounded.
- **Type consistency check:** `H1CompleteRequest`...`H5CompleteRequest` field names match exactly between `backend/app/schemas/handshakes.py` (Task 10) and `frontend/shared/lib/types/handshake-requests.ts` (Task 22) — verified field-by-field against the contract doc §4.4 during drafting.
- **Alembic conflict risk:** Task 1 chains onto `ciaran_add_vehicle_length_m` as of this writing — re-run `git fetch origin && alembic heads` immediately before executing Task 1, since three other devs may have landed migrations since this plan was written.
