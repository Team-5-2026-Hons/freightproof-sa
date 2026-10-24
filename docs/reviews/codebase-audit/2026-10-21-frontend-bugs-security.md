# Frontend bugs and security review (Pass 5)

| | |
|---|---|
| Date | 2026-10-21 |
| Branch reviewed | `Ciaran` (`origin/Ciaran`) |
| Commit reviewed | `f4b7360` (`f4b7360afa45b5e1bebc7b641632d8efc548140b`) |
| Checkout at review time | `dev` at `b8c44ea` (the merge of `Ciaran` into `dev`). `origin/Ciaran` was fetched and reviewed from a read-only `git archive` export; nothing was checked out. |
| Scope | `frontend/driver-pwa`, `frontend/dispatcher`, `frontend/shared` |
| Method | Static read only. No build, no `npm install`, no tests run, no `.env*` read, no file edited other than this one. |
| Prior reports | `docs/audits/` does not exist on `Ciaran` or `dev`, so no 2026-10-20 reports and no Pass 4 structure report were available. `docs/reviews/2026-09-10-ciaran-branch-review.md` and `docs/reviews/2026-09-14-security-structure-review.md` (S8) were read for overlap; see "Prior findings". |

Line numbers are for `origin/Ciaran` at `f4b7360`. The `dev` merge commit `b8c44ea` carries the same frontend content for every file cited here.

## Summary

Top findings, highest first:

1. **FE-SEC-01 (High)** The driver app ships in demo mode unless `NEXT_PUBLIC_DEMO_MODE` is exactly `false`. Demo mode accepts any phone number and any OTP, and every phase and checkpoint submit returns success without a network call. The production build guard checks only the API URL.
2. **FE-BUG-01 (High)** When a live phase submit gets an uncoded 409 and the refetched plan shows the phase resolved by someone else (dispatcher override), the submitter reports `recorded`, the draft is deleted and the driver sees "recorded". The driver's evidence never reached the server.
3. **FE-BUG-02 (High)** Offline checkpoint and location enqueues ignore whether the localStorage write succeeded. A cargo photo near the ~5 MB quota fails to persist and the driver is told "Saved. Evidence stored on this device."
4. **FE-SEC-02 / FE-SEC-03 (High)** Personal data survives sign-out: the driver's face photo is cleared only on the profile page's manual sign-out, and substitution captures (seal photos as base64, GPS, seal numbers) are never deleted from IndexedDB.
5. **FE-SEC-06 / FE-SEC-07 (Medium)** Both apps keep the Supabase access and refresh tokens in localStorage, route guards are client-only, and neither app sends a CSP.

Direct answers to the brief:

| Question | Answer |
|---|---|
| Can any offline action be lost or duplicated? | **Yes.** Lost: FE-BUG-01 (live 409 path clears the draft on a false "recorded"), FE-BUG-02 (checkpoint and location enqueue ignores a failed write). Duplicated: FE-BUG-04 (checkpoint artifacts re-uploaded and location pings re-sent after a kill mid-flush). Phase completions are protected by a persisted idempotency key and are neither lost nor duplicated once queued. |
| Does personal data survive logout? | **Yes.** Face photo (idle and superseded-device sign-out), substitution captures (always), and by design the offline queue, phase drafts, retained drafts and exception envelopes (all unencrypted). See FE-SEC-02, FE-SEC-03, FE-SEC-04. |

## Answers to the review questions

**A. Offline queue correctness.**
- Phase entries carry `idempotencyKey`, set once at enqueue and persisted (`queue-storage.ts:48-50`, `useOfflineQueue.ts:518-520`). The live submit generates one key per step mount (`PhaseStepPageClient.tsx:528`) and hands it into the queue on failure (`phase-submitter.ts:316,347,394`), so a queued replay sends the key the live attempt sent. Checkpoints carry `client_report_id` from a per-page ref (`CheckpointPageClient.tsx:49,63-64`). Exceptions carry `client_report_id` as the IndexedDB key. Location batches have no key by design (`queue-storage.ts:72-74`).
- Replay twice: a phase replay after a lost response hits the server's idempotency gate and is cleared on `EVIDENCE_ALREADY_RECORDED` (`useOfflineQueue.ts:405-410`). Checkpoint photo uploads and location pings can run twice (FE-BUG-04).
- Order: the localStorage queue is flushed in append order. A failed phase entry stalls every later phase entry for the same trip (`useOfflineQueue.ts:386-398,420`). Checkpoint and location entries do not depend on phases and are not stalled. Exception envelopes flush independently and before the localStorage queue (`useOfflineQueue.ts:376`).
- 409/422: every coded or uncoded refusal is retained as `needs-attention` with the server's reason; nothing is dropped (`useOfflineQueue.ts:411-416`, `live-write-conflict.ts:78-94`). The driver can retry or dismiss (`retryAttention`, `dismissAttention`). The 2026-09-10 finding that a 409 deleted evidence is fixed on this tree. The remaining loss path is the *live* 409 branch, FE-BUG-01.
- Clearing: entries are removed only after `sendEntry` resolves or the server proves a duplicate (`useOfflineQueue.ts:400-410,427-436`). The removal is a single read-modify-write after the whole pass, which creates the replay window in FE-BUG-04.
- Reload and logout: the queue is in localStorage under one global key and survives both. Each entry records `actorId`; `isSendableNow` sends only entries whose `actorId` equals the signed-in driver (`useOfflineQueue.ts:79-81,397`). Entries with no actor are quarantined and never sent (`queue-storage.ts:174-177`). A second driver on the same handset therefore cannot replay the first driver's actions, but the first driver's photos and GPS stay on the device (FE-SEC-04).

**B. Personal data on the device.** Mapped in FE-SEC-02, FE-SEC-03 and FE-SEC-04. Nothing is encrypted at rest by app code. Photos are stored as base64 data URLs in localStorage for phase drafts and queued phases and checkpoints, and as Blobs in IndexedDB for exceptions.

**C. Tokens.** Both apps create the Supabase client with default options, so the access token, refresh token and user object live in localStorage (FE-SEC-06). No cookies are set by either app and there is no `middleware.ts`. Token refresh: driver `client.ts:242-265` refreshes once on 401 and surfaces the original 401 if refresh fails; the offline queue treats 401 as transient and keeps the entry (`live-write-conflict.ts:84-86`). Dispatcher `client.ts:163-184` retries once with a changed token, then signs out. The receiver capability token is never built or stored by the driver app: `scan_url` comes from the server, is held in React state and rendered into a QR (`useRotatingHandover.ts:45,78`, `ReceiverHandover.tsx:99`). It is not logged (`useRotatingHandover.ts:84,125` log only the error).

**D. XSS.** No `innerHTML`, `eval`, Markdown rendering or sanitiser use outside tests. The single `dangerouslySetInnerHTML` (`driver-pwa/app/layout.tsx:46`) injects a module constant. Leaflet `divIcon({ html })` sites use constants only. Backend data reaches `href`, `src` and an `iframe` through Supabase signed URLs without a scheme check (FE-SEC-09, Low).

**E. Redirects and messaging.** Both return-path validators were traced and exercised by a subagent with absolute, protocol-relative, backslash, control-character and traversal inputs; every cross-origin form is rejected (`dispatcher/lib/navigation/returnTo.ts:19-35`, `shared/lib/session/return-path.ts:36-59`). Every other `router.push` target is a `ROUTES.*` constant or a helper-built same-origin path. There are no `postMessage` or `message` listeners.

**F. Capacitor and PWA.** No `server.url`, no `allowNavigation`, no cleartext setting (`capacitor.config.ts`). The service worker never caches `/api/` responses (`sw.ts:25-28`) and caches only navigation shells. Android `allowBackup="true"` (FE-SEC-05). No CSP anywhere, no headers at all for the driver browser PWA (FE-SEC-07).

**G. Dev and debug code.** Dev pages are gated by build-time `NODE_ENV` and `notFound()` or a default-off flag. The one that is not gated is demo mode itself (FE-SEC-01). `NEXT_PUBLIC_DEV_PASSWORD` is inlined into the bundle whenever it is set at build time (FE-SEC-08).

**H. Logging.** 108 driver and 16 dispatcher `console.*` calls; none passes a token, capability token, coordinates, photo data or a full response body as an argument. The dispatcher's `ApiError.detail` holds the raw backend `detail` and is logged with the error object (FE-SEC-10, Low). No error reporter is installed. No hardcoded secrets; the only literals are placeholder Supabase values and `localhost` API fallbacks.

**I. Other bugs.** FE-BUG-03 to FE-BUG-07. Dispatcher cache invalidation after mutations was not reviewed (see "Not covered").

## Security findings

### FE-SEC-01 · High · dev-exposure
- **File:line:** `frontend/driver-pwa/lib/constants/env.ts:2`; `lib/auth/defaults.ts:19,25`; `lib/auth/DemoOtpAuth.ts:34-38`; `lib/api/phases.ts:474-477`; `lib/api/checkpoints.ts:107-125`; `next.config.ts:14-23`
- **What is wrong:** `IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'` is on by default. In demo mode `DemoOtpAuth.verifyOtp` ignores the phone number and OTP and writes a sessionStorage flag; `submitPhase` and `submitCheckpoint` resolve with a fake success and never call the backend; `useArtifactUpload`, `LocationContext` and `TripContext` are likewise stubbed. The production build guard in `next.config.ts` throws only when `NEXT_PUBLIC_API_URL` is unset or `localhost`. A build pipeline that sets the API URL but forgets `NEXT_PUBLIC_DEMO_MODE=false` produces an APK that logs anyone in as the fixture driver and shows "Departure recorded" toasts for evidence that was never sent.
- **Impact:** A misconfigured build silently records nothing while telling the driver every phase is recorded.
- **Evidence:** `env.ts:2` `export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'`; `DemoOtpAuth.ts:34-38` `async verifyOtp(_phoneNumber, _otp) { await pause(...); sessionStorage.setItem(DEMO_SESSION_KEY, 'true') }`; `phases.ts:474-477` `if (IS_DEMO_MODE) { ...; return { ok: true, trip: null, phaseStatus: 'completed' } }`; `next.config.ts:15-16` checks `apiUrl` only.
- **Confidence:** Verified.
- **Suggested fix:** Invert the default (`=== 'true'`) and extend the production guard in `next.config.ts` to throw when demo mode is on.
- **Test that would catch it:** none exists (a config test asserting `IS_DEMO_MODE === false` when the var is unset would).

### FE-SEC-02 · High · pii-storage
- **File:line:** `frontend/driver-pwa/lib/profile/driver-photo.ts:34-52`; `app/(app)/profile/page.tsx:119-125`; `lib/context/AuthContext.tsx:151-157,176-183`; `lib/api/client.ts:117-128,235-240`
- **What is wrong:** The driver's face photo is stored as a base64 JPEG in localStorage under `fp:driver-photo:<driverId>`. It is removed only in the profile page's `confirmSignOut`. The two other sign-out paths, idle expiry (`handleIdleExpiry` → `performSignOut`) and the superseded-device 401 (`signOutSupersededDevice` → `supabase.auth.signOut()`), never call `clearDriverPhoto`. Scenario: driver A's session expires while the phone sits in the cab; driver B signs in on the same handset; A's photo remains in storage. The file comment claims it is "cleared on sign-out".
- **Impact:** A face image, which the code itself labels POPIA personal data, stays on a shared device after the session that owned it ended.
- **Evidence:** `profile/page.tsx:122` `clearDriverPhoto(user.id)` is the only caller; `AuthContext.tsx:151-157` `performSignOut` calls `invalidateActorLease`, `port.signOut`, `clearActivity`, `setUser(null)` and nothing else; `client.ts:117-128` sets `fp.signedOutReason` and calls `supabase.auth.signOut()`.
- **Confidence:** Verified.
- **Suggested fix:** Clear the photo inside `performSignOut` (and in the superseded-device path via the auth listener), not in the page.
- **Test that would catch it:** `driver-pwa/lib/context/__tests__/AuthContext*.test.tsx` (no idle-expiry assertion on the photo key exists).

### FE-SEC-03 · High · pii-storage
- **File:line:** `frontend/driver-pwa/lib/offline/substitution-store.ts:20-23,255,276-283`; `lib/hooks/useSubstitutionCapture.ts:245-253,262-264`
- **What is wrong:** Driver-substitution captures are stored in IndexedDB `fp_substitution_store` (store `captures`, keyed `${actorId}:${requestId}`) with seal photos as base64 `dataUrl`, the phone position, seal numbers, discrepancy notes and the server result. `removeCapture` exists but has no caller anywhere in `driver-pwa`. After a server acknowledgement the photo strings are blanked but the record, GPS, seal numbers and result stay forever. A capture that ends `retained` (`SUBSTITUTION_NOT_PENDING`, `TRIP_HANDED_OVER`) keeps its full photo bytes forever. The `late` store (`LateEvidenceProgress`) has no delete function at all. No sign-out path touches either store.
- **Impact:** Handover evidence and GPS for every substitution a driver ever performed accumulate on the device indefinitely and survive sign-out.
- **Evidence:** `grep -rn removeCapture driver-pwa` returns only the definition at `substitution-store.ts:255`; `useSubstitutionCapture.ts:247-253` `saveCapture({ ...working, status: 'saved', result, ..., photos: check.photos.map((photo) => ({ ...photo, dataUrl: '' })) })`; `:262-264` `saveCapture({ ...working, status: 'retained', note: NOT_PENDING_NOTE })`.
- **Confidence:** Verified.
- **Suggested fix:** Delete `saved` captures and their late-progress rows once the trip closes, and purge all stores for an account on its sign-out after the retention window the FP-83 contract allows.
- **Test that would catch it:** none exists.

### FE-SEC-04 · High · pii-storage
- **File:line:** `frontend/driver-pwa/lib/offline/queue-storage.ts:14,41-80`; `lib/offline/retained-drafts.ts:10-11`; `lib/hooks/usePhaseDraft.ts:60`; `lib/offline/exception-store.ts:8-54`; `lib/context/AuthContext.tsx:151-157`
- **What is wrong:** All driver evidence stores persist after sign-out and are unencrypted: `fp_offline_queue` (phase evidence with `sealPhotoDataUrl`, `podPhotoDataUrl`, `linehaulPhotoDataUrl` and `linehaulPdfDataUrl` as base64, seal numbers, notes, and GPS `position`; checkpoint `cargoPhotoDataUrl` and GPS; location ping batches), `fp_draft_<trip>_<phase>` and `fp_retained_draft_<uuid>` (the same evidence shapes), and IndexedDB `fp_exception_store` (free-text descriptions, GPS, photo Blobs). `performSignOut` clears none of them. This is deliberate under FP-83 (evidence must not be deleted; entries are stamped with `actorId` and quarantined or held for other accounts), and the actor scoping does stop another login from sending them. It does not stop anyone with the unlocked handset, a WebView data extraction or an Android backup (FE-SEC-05) from reading them. Photos as base64 in localStorage also exhaust the ~5 MB quota, which is what makes FE-BUG-02 reachable; the code already drops the linehaul PDF on a failed write (`useOfflineQueue.ts:531-539`).
- **Impact:** Seal, cargo and POD photographs plus GPS for other drivers remain readable on a shared handset after they sign out.
- **Evidence:** `AuthContext.tsx:151-157` clears only the auth session, activity stamp and user state; the storage inventory found no `localStorage.clear()`, `deleteDatabase` or per-store purge on any sign-out path; `queue-storage.ts:14` `export const QUEUE_KEY = 'fp_offline_queue'` is global, not per account.
- **Confidence:** Verified (storage map), design intent confirmed from `queue-storage.ts:15-26` and `retained-drafts.ts:2-7` comments.
- **Suggested fix:** Encrypt the evidence stores at rest (a per-account key held by the native layer, e.g. Capacitor secure storage), and move photo bytes out of localStorage into IndexedDB Blobs as the exception store already does.
- **Test that would catch it:** none exists.

### FE-SEC-05 · Medium · capacitor-pwa
- **File:line:** `frontend/driver-pwa/android/app/src/main/AndroidManifest.xml:5`
- **What is wrong:** `android:allowBackup="true"`. Android Auto Backup includes the app's internal data directory, which holds the WebView's localStorage and IndexedDB, so the evidence stores in FE-SEC-04, the face photo in FE-SEC-02 and the Supabase refresh token in FE-SEC-06 are copied to the user's Google account backup. There is no `networkSecurityConfig` and no `usesCleartextTraffic` setting (the latter defaults to false on targetSdk 35, which is fine).
- **Impact:** Personal data and a long-lived refresh token leave the device to a third-party cloud backup.
- **Evidence:** Manifest line reported by the dev-gating inventory; `android/variables.gradle` targetSdk 35. I did not read the native project beyond this.
- **Confidence:** Likely (manifest value verified; the inclusion of WebView storage in Auto Backup is platform behaviour, not repo code).
- **Suggested fix:** Set `android:allowBackup="false"` (or a backup rules file excluding `app_webview`).
- **Test that would catch it:** none exists.

### FE-SEC-06 · Medium · token
- **File:line:** `frontend/driver-pwa/lib/supabase.ts:13`; `frontend/dispatcher/lib/supabase/client.ts:34-36`; `frontend/dispatcher/app/(app)/layout.tsx:19-43`
- **What is wrong:** Both apps call `createClient` without auth storage options, so supabase-js keeps the session (access JWT, refresh token, user object including the phone number) in localStorage. Neither app sets a cookie, so there are no HttpOnly, Secure or SameSite flags to report. The dispatcher has no `middleware.ts`; route protection is a client effect that `router.replace`s to login when `user` is null. Any XSS in either app reads the refresh token and owns the session for its lifetime.
- **Impact:** A single script injection yields a durable, reusable session for the driver or dispatcher.
- **Evidence:** `supabase.ts:13` `export const supabase = createClient(supabaseUrl, supabaseAnonKey)`; dispatcher `client.ts:34-36` passes only `global.fetch`; `(app)/layout.tsx:20,39` `if (!isLoading && !user) { ... router.replace(ROUTES.login) }`. The storage inventory found no `document.cookie`, `cookies()` or `Set-Cookie` in scope.
- **Confidence:** Verified for the code; the localStorage location is supabase-js default behaviour.
- **Suggested fix:** For the dispatcher, move to `@supabase/ssr` cookie sessions with a middleware guard; for the APK, back the Supabase `storage` option with a native secure store.
- **Test that would catch it:** none exists.

### FE-SEC-07 · Medium · capacitor-pwa
- **File:line:** `frontend/dispatcher/next.config.js:3-13,22-24`; `frontend/driver-pwa/next.config.ts:32-36`
- **What is wrong:** Dispatcher headers actually sent: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. There is no `Content-Security-Policy` (the file comment says so) and no `Strict-Transport-Security`. The driver browser PWA sends no headers at all because `headers()` is inert under `output: 'export'`; the comment defers them to the host, and the repo has no `vercel.json`, `netlify.toml` or `public/_headers` for either app, so there is nothing to show the host sets them.
- **Impact:** No CSP means any injected script in either app runs unconstrained; with FE-SEC-06 that is a full session takeover.
- **Evidence:** quoted above; dev-gating inventory confirmed no host header files exist.
- **Confidence:** Verified.
- **Suggested fix:** Add a nonce-based CSP via middleware in the dispatcher and a host-level header file for the driver PWA; add HSTS to both.
- **Test that would catch it:** none exists.

### FE-SEC-08 · Medium · dev-exposure
- **File:line:** `frontend/dispatcher/app/(app)/dev/tokens/page.tsx:12-15,53-54`
- **What is wrong:** The page reads `process.env.NEXT_PUBLIC_DEV_EMAIL` and `process.env.NEXT_PUBLIC_DEV_PASSWORD` and gates itself with a runtime `if (process.env.NODE_ENV === 'production') notFound()`. `NEXT_PUBLIC_*` values are inlined at build time wherever referenced, and `notFound()` does not remove the component from the bundle. If the production build environment carries these variables (a shared `.env` or CI secret set for every build), the dispatcher password ships in the client JavaScript even though the route 404s. The file's own comment states the credentials "are inlined into the client bundle".
- **Impact:** A real dispatcher password in a public JS chunk.
- **Evidence:** `:53-54` `email: process.env.NEXT_PUBLIC_DEV_EMAIL ?? '', password: process.env.NEXT_PUBLIC_DEV_PASSWORD ?? ''`; `:15` runtime `notFound()`.
- **Confidence:** Likely (inlining is Next.js behaviour; whether CI sets the variables was not checked).
- **Suggested fix:** Delete the force-sign-in control, or read the credentials only inside a `NODE_ENV === 'development'` branch so the production bundle never references the variables, and never define them in CI.
- **Test that would catch it:** none exists.

### FE-SEC-09 · Low · xss
- **File:line:** `frontend/dispatcher/components/domain/EvidenceDocument.tsx:55,66`; `components/domain/EvidencePhoto.tsx:102,109`; `frontend/driver-pwa/components/trip/DriverParticipationHistory.tsx:130`
- **What is wrong:** Backend-supplied `signed_url` strings go straight into `<a href target="_blank">`, `<img src>` and an `<iframe src>` without a scheme or host check, and the iframe has no `sandbox`. Today the value is a Supabase signed URL, so this is only reachable if the backend or storage provider is compromised; it is hardening, not a live path.
- **Impact:** A hostile URL from the API could open `javascript:` in the document link or frame arbitrary content inside the dispatcher origin.
- **Evidence:** `EvidenceDocument.tsx:66` `<iframe src={artifact.signed_url} ...>` with no `sandbox`; `EvidencePhoto.tsx:102` `<img key={retryAttempt} src={artifact.signed_url!} ...>`.
- **Confidence:** Verified (code), Speculative (exploit path).
- **Suggested fix:** Allow only `https:` URLs on the expected storage host and add `sandbox` to the iframe.
- **Test that would catch it:** none exists.

### FE-SEC-10 · Low · logging
- **File:line:** `frontend/dispatcher/lib/api/client.ts:37-38,193`; `frontend/dispatcher/app/(app)/trips/new/page.tsx:219`; `lib/hooks/useCrewAvailability.ts:45`; `frontend/driver-pwa/lib/hooks/usePhaseDraft.ts:31,63,89`
- **What is wrong:** The dispatcher `ApiError` keeps the raw backend `detail` (string, 422 field list or object) and sixteen ungated `console.*` calls log the error object in production, so whatever the backend puts in `detail` reaches the console and any attached DevTools or crash tooling. Driver logs include localStorage keys that embed trip and phase-event UUIDs. No call logs a token, GPS value, photo or full response body directly.
- **Impact:** Backend error wording, which may quote submitted data, is exposed in browser consoles; low on its own.
- **Evidence:** `client.ts:37` `public readonly detail: unknown = null` documented as "The response body's `detail`, as sent"; inventory classified all 124 calls, none gated except `useLocation.ts:149`.
- **Confidence:** Verified.
- **Suggested fix:** Log `status` and `message` only in production builds.
- **Test that would catch it:** none exists.

### FE-SEC-11 · Info · dev-exposure
- **File:line:** `frontend/dispatcher/components/auth/AdminOnly.tsx:16`; `lib/context/ForensicModeContext.tsx:7,27,40`; `frontend/driver-pwa/lib/hooks/usePushNotifications.ts:50-54`
- **What is wrong:** `AdminOnly` and the forensic toggle (persisted as `fp.forensicOn` in localStorage) are UI-only gates; the backend's `require_admin_dispatcher` dependency is the real check and was not reviewed here. Noted so nobody treats the UI gate as authorisation.
- **Confidence:** Verified. No fix needed on the frontend.

### FE-SEC-12 · Info · logging
- **File:line:** `frontend/dispatcher/lib/geocode/overpass.ts:128`; `lib/geocode/photon.ts:120`; `frontend/driver-pwa/lib/api/geocode.ts:24`
- **What is wrong:** Raw `fetch` to third parties outside the typed wrapper: Overpass receives a precinct pin's coordinates, Photon receives the dispatcher's typed address text. Both are depot data, not personal data. `driver-pwa/lib/api/geocode.ts` would send the driver's GPS and the Maps key to Google in a query string but has no importer (dead code). These are the only raw `fetch` calls besides the dispatcher SSE reader, which does attach the bearer token correctly (`RealtimeProvider.tsx:141-143`).
- **Confidence:** Verified. Suggested fix: delete the unused reverse-geocode module.

### FE-SEC-13 · Info · dev-exposure
- **File:line:** `frontend/dispatcher/lib/api/client.ts:14`; `frontend/driver-pwa/lib/utils/precinct-name.ts:1`; `lib/utils/directions.ts:2`; `next.config.ts:81-90`
- **What is wrong:** The dispatcher falls back to `http://localhost:8000` with no production guard (the driver app has one). Two driver utilities resolve precinct names and directions from `@shared/lib/mocks/precincts` in every mode, and seven mock trip IDs are baked into the service-worker precache list.
- **Confidence:** Verified. Hardening only.

## Bug findings

### FE-BUG-01 · High · ui-state
- **File:line:** `frontend/driver-pwa/lib/submission/phase-submitter.ts:296-301,358-388`; `app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx:444-460`
- **What is wrong:** On an uncoded 409 the submitter refetches the trip and, if the addressed phase is in any resolved status, returns `{ kind: 'recorded', trip: fetched }`. `isResolvedPhase` treats `completed`, `exception` and `overridden` alike. The step page then calls `clearDraft(evidence)` and toasts "`<Phase> recorded`". Scenario: the driver is at the bay with seal photo and number in the draft; the dispatcher overrides the departure phase moments earlier; the driver swipes; the server 409s because the row is already resolved; the refetch shows `overridden`; the app deletes the seal photo and tells the driver "Departure recorded". The driver's evidence was never stored and there is no retained copy. The same happens if the backend resolves the row as `exception`. Only the driver's own earlier attempt (`completed` by this actor) should be read as "already landed", and the server now has a coded `EVIDENCE_ALREADY_RECORDED` answer for exactly that case (`live-write-conflict.ts:33-36`).
- **Impact:** A custody capture is discarded with a success message and no record on either side.
- **Evidence:** `phase-submitter.ts:299-301` `return phase !== null && phase.status !== 'pending' && phase.status !== 'in_progress'`; `:380-383` `if (isResolvedPhase(addressedPhase)) { return { kind: 'recorded', trip: fetched, addressedPhase } }`; `PhaseStepPageClient.tsx:444-448` `case 'recorded': { onResolved(outcome.trip, evidence); clearDraft(evidence); ...`.
- **Confidence:** Likely. The frontend path is traced end to end; whether the backend returns an uncoded 409 (rather than `EVIDENCE_ALREADY_RECORDED` or a coded conflict) for an overridden row was not checked (backend is out of scope).
- **Suggested fix:** Treat only a phase completed by the same actor and idempotency key as recorded; for `overridden` or `exception` return `conflict` (keep the draft) or retain the capture as late evidence.
- **Test that would catch it:** `driver-pwa/lib/submission/__tests__/phase-submitter-queue.test.ts` (add a case: 409, refetch shows `overridden`, expect the draft kept).

### FE-BUG-02 · High · queue
- **File:line:** `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:696-725`; `lib/offline/queue-storage.ts:135-151`; `app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx:86-96`; `lib/context/LocationContext.tsx:102,112,119`
- **What is wrong:** `saveQueue` returns `false` when `localStorage.setItem` throws (quota exceeded or storage blocked). `enqueuePhase` checks it and even retries without the PDF; `enqueueCheckpoint` and `enqueueLocation` discard the boolean. The checkpoint page then shows a success toast, "Checkpoint recorded. Saved. Evidence stored on this device.", and navigates away. Scenario: offline in a dead zone with two queued phases already holding base64 photos (several MB), the driver logs a checkpoint with a cargo photo; `setItem` throws `QuotaExceededError`; the entry is not stored; the driver sees "Saved"; on reconnect nothing is sent and the photo is gone. The 2026-09-10 review raised the unchecked `saveQueue` for these two paths; it is still open.
- **Impact:** A checkpoint with its cargo photo and GPS is lost while the driver is told it is stored. Location pings are lost silently.
- **Evidence:** `useOfflineQueue.ts:707` `saveQueue([...loadQueue(), entry])` with the result ignored; `:721` same; `queue-storage.ts:143-150` returns `false` on a thrown `setItem`; `CheckpointPageClient.tsx:89-94` `enqueueCheckpoint(String(trip.id), evidence); notify({ kind: 'success', title: 'Checkpoint recorded', body: 'Saved. Evidence stored on this device.' })`.
- **Confidence:** Verified.
- **Suggested fix:** Return the `saveQueue` result from both enqueue functions and show the "not saved" state the exception path already has (`EnqueueExceptionResult.persisted`).
- **Test that would catch it:** `driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts` (no quota-failure case for checkpoint or location exists).

### FE-BUG-03 · Low · queue
- **File:line:** `frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx:85`; `lib/utils/is-queueable-failure.ts:6-9`
- **What is wrong:** The checkpoint page classifies retryable failures as `!(err instanceof ApiError) || err.status >= 500`. A request timeout is an `ApiError` with status 0 and a rate limit is 429, so both fall to the inline-error branch instead of the queue, unlike every other capture which uses `isQueueableFailure` (status 0 or 5xx). The driver stays on the screen with the same `client_report_id` and can retry manually, so nothing is lost, but a stalled socket on cellular gives an error instead of "stored on this device".
- **Impact:** Inconsistent offline behaviour; a timed-out checkpoint is not queued.
- **Evidence:** quoted above.
- **Confidence:** Verified.
- **Suggested fix:** Use `isQueueableFailure(err)` here.
- **Test that would catch it:** `driver-pwa/app/(app)/trip/in-transit/checkpoint/__tests__/` (no status-0 case exists).

### FE-BUG-04 · Medium · race
- **File:line:** `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:393-436`; `lib/api/checkpoints.ts:126-140`; `lib/api/artifacts.ts:28-31,104-107`; `lib/offline/queue-storage.ts:72-74`
- **What is wrong:** The flush loop sends every entry first and removes the disposed IDs in one `updateQueue` after the loop. Each phase send can take up to 30 s, so a kill, crash or OS suspension mid-pass leaves already-accepted entries in storage, and the next flush re-sends them. For phases this is harmless (same idempotency key; server answers 200 or `EVIDENCE_ALREADY_RECORDED`). For checkpoints, `submitCheckpoint` re-uploads the cargo photo through `/artifacts` with no `attribution`, which the code says the server stores "unattributed, exactly as before", so there is no byte-level dedupe for it; a second artifact row is created before `client_report_id` dedupes the checkpoint itself. Location batches have no key and are appended again as duplicate trail rows (accepted by design in the type comment).
- **Impact:** Duplicate photo artifacts and duplicate GPS trail rows after an interrupted sync; evidence noise, not evidence loss.
- **Evidence:** `useOfflineQueue.ts:401-402` `await sendEntry(entry); disposedIds.add(entry.id)` inside the loop, `:427-436` single write after the loop; `artifacts.ts:29-31` comment on unattributed uploads; `checkpoints.ts:129-133` uploads on every call.
- **Confidence:** Likely.
- **Suggested fix:** Remove each entry from storage immediately after its own send succeeds, and persist the uploaded artifact id back onto the checkpoint entry the way the exception store does (`ExceptionPhotoRecord.uploadedArtifactId`).
- **Test that would catch it:** `driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts` (no interrupted-flush case exists).

### FE-BUG-05 · Low · ui-state
- **File:line:** `frontend/driver-pwa/lib/api/client.ts:73-78,117-120`
- **What is wrong:** `SIGNED_OUT_REASON_KEY` (`fp.signedOutReason`) is written with "Signed in on another device." when the backend reports a superseded session, and the comment says the login screen reads it. No non-test code reads or clears it. The driver is bounced to login with no explanation, and the value persists for the tab's lifetime.
- **Impact:** A driver whose account was taken over on another handset gets no message, which hides a security-relevant event from them.
- **Evidence:** `grep -rn signedOutReason driver-pwa` matches only `client.ts:77,119` outside tests.
- **Confidence:** Verified.
- **Suggested fix:** Read and clear the key in `app/login/page.tsx` and show the message.
- **Test that would catch it:** `driver-pwa/lib/api/__tests__/client.test.ts:249-260` asserts the write; no login-page test asserts the read.

### FE-BUG-06 · Low · ui-state
- **File:line:** `frontend/driver-pwa/lib/hooks/usePushNotifications.ts:36,50-54`
- **What is wrong:** A `GATE_ARRIVAL` push notification's `data.phase_type` is cast to `GateArrivalPhaseType` with no runtime check and passed to `gateArrivalRoute`, which indexes `STEP_SLUGS[phaseType][0]`. An unexpected value from the push provider throws inside the listener instead of falling back to the trip screen.
- **Impact:** A malformed push crashes the notification handler; no data exposure.
- **Evidence:** reported by the redirect inventory from the file; I read only the cited lines.
- **Confidence:** Likely.
- **Suggested fix:** Validate `phase_type` against the known set before routing.
- **Test that would catch it:** none exists.

### FE-BUG-07 · Low · queue
- **File:line:** `frontend/driver-pwa/lib/offline/queue-storage.ts:121-131,186-216`
- **What is wrong:** The migration preserves an unparseable queue value only while the version marker is below 2. Once the marker is 2, `loadQueue` returns `[]` on a parse failure and the next `saveQueue([...loadQueue(), entry])` overwrites the damaged value, discarding whatever entries it held. A partial `setItem` under quota pressure is the realistic way to get here.
- **Impact:** Unrecoverable loss of queued evidence after storage corruption.
- **Evidence:** `loadQueue` `catch { return [] }`; `migrateQueueForCustody` `if (Number(store.getItem(QUEUE_VERSION_KEY)) >= QUEUE_VERSION) return true` before any backup.
- **Confidence:** Speculative.
- **Suggested fix:** Back up the raw value under `fp_offline_queue_unreadable` whenever `loadQueue` fails to parse, not only during migration.
- **Test that would catch it:** `driver-pwa/lib/offline/queue-storage` tests (none for post-migration corruption).

## Checked, no finding

- Double submit: `startPhaseSubmission` dedupes on `[generation, trip, actor, custody, phaseEventId]` (`phase-submitter.ts:448-451`); the checkpoint swipe is disabled while `submitting`; the panic handler sets `sending` first. The in-transit arrival generates a fresh idempotency key per swipe (`InTransitPageClient.tsx:266`) but a second swipe cannot start while the first is running.
- Open redirects: both validators reject every cross-origin form tried; the only accepted odd inputs (`/a/..//evil.example`) resolve same-origin.
- Service worker: API responses are `NetworkOnly`; only navigation shells are cached; no personal data in Cache Storage.
- Capacitor: no `server.url`, no `allowNavigation`, one launcher intent filter, FileProvider not exported.
- Capability token: never built, stored or logged by the driver app.
- Hardcoded secrets: none. Placeholder Supabase literals and `localhost` fallbacks only.
- Dev routes: `/dev/tokens` (both apps) and `/dev/design` 404 outside development at build time; `/dev/triggers` is default-off behind `NEXT_PUBLIC_DEV_PANEL === 'true'` and the auth layout.

## Prior findings on this tree

- 2026-09-10 "409 treated as success and entry dropped": fixed. Every refusal is retained with its reason (`live-write-conflict.ts`, `useOfflineQueue.ts:411-416`). The live-submit variant survives as FE-BUG-01.
- 2026-09-10 "unchecked `saveQueue`": fixed for phases and exceptions, still open for checkpoints and locations (FE-BUG-02).
- 2026-09-14 S8 "offline evidence not isolated by account": replay isolation is fixed by FP-83 actor stamping. Retention and encryption after sign-out remain (FE-SEC-04).

## Files read by the reviewer

driver-pwa: `lib/hooks/useOfflineQueue.ts`, `lib/offline/queue-storage.ts`, `lib/session/custody-context.ts`, `lib/utils/is-queueable-failure.ts`, `lib/offline/live-write-conflict.ts`, `lib/api/client.ts`, `lib/tokens.ts`, `lib/supabase.ts`, `lib/constants/env.ts`, `lib/context/AuthContext.tsx`, `lib/auth/SupabaseOtpAuth.ts`, `lib/auth/DemoOtpAuth.ts`, `lib/auth/defaults.ts`, `lib/session/useAccountGuard.ts`, `lib/submission/phase-submitter.ts`, `lib/api/checkpoints.ts`, `lib/api/locations.ts`, `lib/api/phases.ts`, `lib/api/handover.ts`, `lib/api/artifacts.ts`, `lib/hooks/useRotatingHandover.ts`, `lib/hooks/usePhaseDraft.ts`, `lib/profile/driver-photo.ts`, `app/sw.ts`, `next.config.ts`, `capacitor.config.ts`; partial: `lib/offline/exception-store.ts` (1-140), `lib/offline/retained-drafts.ts` (1-90), `lib/hooks/useSubstitutionCapture.ts` (236-270), `app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx` (380-600), `app/(app)/trip/in-transit/InTransitPageClient.tsx` (240-300), `app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx` (58-125), `app/(app)/trip/panic/PanicPageClient.tsx` (55-130), `app/(app)/profile/page.tsx` (100-130), `app/dev/tokens/page.tsx` (gate lines), `app/otp/page.tsx` (grep).

dispatcher: `lib/api/client.ts`, `lib/supabase/client.ts`, `lib/auth/SupabasePasswordAuth.ts`, `lib/context/AuthContext.tsx`, `app/(app)/layout.tsx`, `components/auth/AdminOnly.tsx`, `lib/navigation/returnTo.ts`, `lib/cache/sessionCache.ts`, `next.config.js`; partial: `components/domain/EvidencePhoto.tsx` (90-115), `app/(app)/dev/tokens/page.tsx`, `app/(app)/dev/triggers/page.tsx`, `app/dev/design/page.tsx` (gate lines), `app/(public)/login/page.tsx` (grep).

shared: `lib/session/return-path.ts`.

Also: root `CLAUDE.md`, `graphify-out/GRAPH_REPORT.md` (grep and community sections), `docs/reviews/2026-09-10-ciaran-branch-review.md`, `docs/reviews/2026-09-14-security-structure-review.md`, and the three 2026-10-19/20 reviews (grep only).

Four Sonnet subagents produced inventories of storage calls, HTTP calls and idempotency keys, DOM/URL/redirect/message sinks, and console calls plus dev gating. Every High finding above was re-read at the cited lines by the reviewer; Medium and Low findings marked "Likely" rest partly on inventory output.

## Not covered

- `frontend/receiver` and `frontend/client-portal`: outside the three listed directories. Two leads surfaced in passing and were not investigated: `receiver/app/h/[token]/HandoverPageClient.tsx:36-75` keeps `{name, idNumber, token}` in sessionStorage under `fp_handover_identity`, and `client-portal/lib/api.ts:13-60` keeps an audit-pack capability grant in localStorage. Both deserve their own pass.
- Not read in full: `lib/context/TripContext.tsx`, `lib/context/LocationContext.tsx`, `lib/offline/exception-sync.ts`, `lib/offline/late-evidence-sync.ts`, `lib/offline/retained-evidence.ts`, `lib/offline/substitution-store.ts`, `lib/hooks/useSubstitutionCapture.ts`, `lib/hooks/useArtifactUpload.ts`, `dispatcher/lib/realtime/*`, `dispatcher/lib/hooks/useDevTriggers.ts`, `components/dev/*`, `shared/lib/mocks/*`.
- Dispatcher stale-data-after-mutation behaviour (question I, first bullet) was not reviewed.
- Backend contract assumptions in FE-BUG-01 (409 shape for an overridden row) and FE-BUG-04 (artifact dedupe for unattributed uploads) were not checked against backend code.
- Android and iOS native projects beyond `AndroidManifest.xml`, `file_paths.xml` and `variables.gradle` (read by a subagent); the merged manifest, `Info.plist` and Gradle build settings were not read.
- supabase-js session persistence is reported from library defaults, not from repo code, and no build was run to confirm bundle contents for FE-SEC-08.
- Tests were not reviewed for quality; they were cited only where they are the evidence for a behaviour.
