# Driver Phone Auth (Supabase OTP) — Design

Date: 2026-06-23
Branch: feature/gps-warehouse-geofencing
Status: Approved

## Problem

Drivers currently log into `driver-pwa` through a fully mocked `AuthContext` (hardcoded driver, no Supabase call). The dispatcher app already has real Supabase auth (email/password). Drivers need the equivalent for phone + OTP:

- A driver whose phone number is already provisioned (created via `POST /api/v1/drivers` by a dispatcher, which already calls `create_driver_auth_user()`) must be able to sign in with phone + SMS OTP.
- A phone number that has never been registered must be rejected — no new accounts may be created from the login screen.

## Architecture

Mirrors the dispatcher's email/password pattern end-to-end: Supabase issues a JWT, the backend verifies it against Supabase's JWKS, and a FastAPI dependency loads the corresponding DB row. Driver accounts are pre-provisioned by dispatchers; nothing in this feature creates new Supabase auth users.

### Backend

1. **`backend/app/auth/dependencies.py`** — add `get_current_driver()`, structurally parallel to the existing `get_current_dispatcher()`:
   - Reuses `_decode_token()` (JWKS verification) unchanged.
   - New `_require_driver_role(payload)` — asserts `app_metadata.role == "driver"`, raises 403 otherwise (mirrors `_require_dispatcher_role`).
   - Looks up `Driver` by `id == JWT.sub`; 401 if not found or `is_active=False`.
   - `DEMO_MODE` stub `_DEMO_DRIVER` returned when `settings.DEMO_MODE` is set, gated by the same production guard at the bottom of the module.

2. **`backend/app/api/v1/endpoints/drivers.py`** — add:
   ```
   GET /api/v1/drivers/me
   ```
   Registered before `GET /{driver_id}` so the literal path matches first. Uses `get_current_driver`, returns `DriverRead` for the caller's own row. No organization_id filtering needed — driver is scoped to their own JWT subject.

3. **No provisioning changes.** `create_driver_auth_user()` (in `app/integrations/supabase_admin.py`) already creates the Supabase auth user with `app_metadata.role = "driver"` and the registered phone number when a dispatcher adds a driver. This existing behavior is what makes "phone already in the system" work, and is relied upon (see next section) to block unknown numbers.

### Enforcing "unregistered phone = no access"

`signInWithOtp` is called with `shouldCreateUser: false`. Supabase will not send an OTP or create an account for a phone number with no existing Supabase auth user — it returns an error instead. Because driver auth accounts only ever come from dispatcher-side provisioning, this is the complete gate: no backend-side phone lookup is needed before sending the OTP.

### Frontend (`frontend/driver-pwa/`)

1. **New file `lib/api/client.ts`** — typed fetch wrapper, copied from the dispatcher's `lib/api/client.ts` pattern: attaches `Authorization: Bearer <supabase access_token>` (read via `supabase.auth.getSession()`), JSON in/out, `ApiError` class. Used for `GET /api/v1/drivers/me`.

2. **`lib/context/AuthContext.tsx`** — replace the mock implementation with one modeled on the dispatcher's `AuthContext`:
   - On mount: `supabase.auth.getSession()` → if a session exists, fetch `/api/v1/drivers/me` and populate `user`; otherwise `user = null`.
   - `supabase.auth.onAuthStateChange()` keeps `user` in sync across tab refresh/token refresh/logout.
   - `requestOtp(phone)`:
     - Demo mode (`IS_DEMO_MODE`): existing mock delay, unchanged behavior.
     - Real mode: `supabase.auth.signInWithOtp({ phone, options: { channel: 'sms', shouldCreateUser: false } })`; throws the Supabase error on failure so the caller (login page) can display it.
   - `signIn({ phone_number, otp })`:
     - Demo mode: existing mock behavior, unchanged.
     - Real mode: `supabase.auth.verifyOtp({ phone: phone_number, token: otp, type: 'sms' })`; on success, fetches `/api/v1/drivers/me` and sets `user`; throws on Supabase error.
   - `signOut()`: `supabase.auth.signOut()`, clears `user`.
   - `IS_DEMO_MODE` branching now lives only inside `AuthContext` — removed from the page components.

3. **`app/login/page.tsx`** — remove the inline `IS_DEMO_MODE` / direct-Supabase branching. Page now only calls `auth.requestOtp(phone)`, catches thrown errors, and displays the message (e.g. Supabase's "Signups not allowed for otp" surfaced as "Phone number not registered — contact your dispatcher.").

4. **`app/otp/page.tsx`** — same simplification: calls `auth.signIn({ phone_number: phone, otp: token })`, catches and displays errors.

No changes to `lib/supabase.ts`, `lib/types/user.ts`, `(app)/layout.tsx` route guard, or any component reading `useAuth().user` — the `DriverUser` shape (`Driver` record) is unchanged, so `ProfilePanel`, `HomeContent`, and `trips/page.tsx` need no edits.

## Testing

Backend (mirrors existing `test_auth_dependencies.py` / `test_auth_router.py` patterns exactly):

- **Unit** (`test_auth_dependencies.py`): `_require_driver_role` passes for `"driver"`, raises 403 for `"dispatcher"`/`"client_viewer"`/missing role.
- **Integration** (new `test_drivers_me.py` or appended to `test_drivers.py`): `GET /drivers/me` — happy path returns the driver's own record; no token → 403; expired token → 401; dispatcher-role token → 403; inactive driver → 401; driver not found (valid JWT, no matching row) → 401.

Frontend: no test framework changes; existing `handshake-progress.test.ts` is unrelated and untouched. Manual verification: login with a known driver phone (real Supabase project, test SMS) and with an unregistered phone, confirming the latter is rejected before OTP send.

## Out of scope

- Twilio/SMS provider configuration inside the Supabase dashboard (external config, not code).
- Changing how dispatchers create or edit drivers — `POST /api/v1/drivers` already provisions the Supabase auth user correctly.
- Any change to `drivers.py`'s existing dispatcher-facing CRUD endpoints beyond adding the new `/me` route.
