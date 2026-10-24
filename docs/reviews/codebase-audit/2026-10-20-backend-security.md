# Backend security review — 2026-10-20 (Pass 3)

| | |
|---|---|
| **Checkout at review time** | branch `dev`, commit `b8c44ea` (not `Ciaran`) |
| **Tree reviewed** | `origin/Ciaran` at commit **`f4b7360`**, exported read-only with `git archive origin/Ciaran backend docs graphify-out CLAUDE.md` into the session scratchpad. Nothing was checked out, edited, or run. |
| **Relationship to `dev`** | `f4b7360` is the second parent of `dev`'s merge `b8c44ea`. `dev` additionally carries the FP-295 analytics-chat work (`analytics_chat.py`, `integrations/ai_chat/`, `orchestration/analytics_chat/`); none of that exists on `Ciaran` and it is out of scope here. |
| **Prior audits** | `docs/audits/2026-10-20-substitution-bugs.md` and `docs/audits/2026-10-20-backend-bugs.md` **do not exist** on `origin/Ciaran` (there is no `docs/audits/` directory on that tree, nor on `dev`). Findings below were therefore not de-duplicated against them. |
| **Method** | Static read only. Three Sonnet workers produced a route inventory (127 routes), a sink inventory (SQL, deserialisation, paths, outbound HTTP, secrets, comparisons, JWT, randomness, 226 logging calls, upload limits, Hedera payloads) and an integration/webhook data-flow summary. Every Critical/High/Medium claim below was traced by me from entry point to impact in the cited lines. `pytest` was not run. No `.env` was read. No secret values appear in this document. |
| **Scope** | `backend/app/{api/v1/endpoints,auth,core,main.py,dev,integrations,storage,blockchain}`, webhook handlers, and logging across those. Frontends, `shared/`, pure correctness bugs, and structure are out of scope. |

## Summary

No Critical or High finding. The authentication core is sound: ES256 pinned, audience checked, role from `app_metadata`, deny-by-default role checks, DB-backed account and session checks, 256-bit capability tokens compared by hash, HMAC-SHA256 webhook with `compare_digest` failing closed, magic-byte sniffing on uploads, server-generated storage keys, and **only a bare 64-hex SHA-256 digest ever reaches Hedera** (`blockchain/hedera.py:26,175-187,98`). Every dispatcher and driver route carries an auth dependency, and every ID-taking dispatcher route I traced scopes by `operator_organization_id`; every driver route scopes by custody or participant check.

The findings that matter are seven Mediums: the per-route rate limiter can be bypassed on the public routes and is effectively a single shared bucket for authenticated users; trip creation accepts precinct IDs from another organisation; the Parcel Perfect session token can reach logs through `httpx` exception text; bearer capability tokens reach logs through `request.url.path`; the dev panel (allowed in production by design) mutates any organisation's trip; and the mock integrations default on and are not refused in production, so a mis-set deploy records identity verification that never happened.

Severity counts: Critical 0 · High 0 · Medium 7 · Low 11 · Info 7.

---

## Findings

### SEC-01 · Medium · config — Per-route rate limits are bypassed on public routes by any `Authorization: Bearer <anything>` header
- **file:line** `backend/app/core/rate_limit.py:149-155`
- **Attacker:** An unauthenticated caller escapes `HANDOVER_PUBLIC` (20/min), `IDVS_VERIFY` (5/min), `AUDIT_PACK_PUBLIC` (120/min), `AUDIT_PACK_EMAIL_CODE` (10/min) and `IDVS_WEBHOOK` (60/min) by sending a different random Bearer header on every request.
- **Attack path:** `rate_limit()`'s dependency reads the raw `authorization` header unconditionally (`:149`); if it starts with `bearer ` the identity becomes `token:<first 64 chars>` (`:153`) with no verification and no fallback to IP. The public routes in `api/v1/endpoints/handover.py:212,258,324,359,392,423` and `audit_packs_public.py:116,132,153,186,214,243,265,300` have no auth dependency, so nothing rejects the stray header (`handover.py:302` even records `bearer_token_present` as evidence). Each forged value gets a private counter, so only the global per-IP middleware (300/min, `core/limits.py:20`) remains. Impact: six-digit audit-pack code guessing runs at 300/min per IP instead of 10/min (still capped at 5 wrong guesses per code by `email_codes.py:38,165`), `/{token}/email-code` sends can be driven at the per-pack cap faster, and `/{raw_token}/verify` vendor-session creation is throttled only by the per-verification idempotency in `receiver_verification.py:418-427`.
- **Preconditions:** `RATE_LIMIT_ENABLED=true` (otherwise there is no limit at all). None else.
- **Confidence:** Verified.
- **Suggested fix:** On routes with no auth dependency, key the budget on IP only (e.g. a `rate_limit(limit, identity="ip")` variant), or key authenticated budgets on the JWT `sub` after decoding.
- **Test that would catch it:** none exists (`tests/unit/test_rate_limit.py` does not send a forged Bearer to a public route).

### SEC-02 · Medium · config — Per-subject budgets are one shared bucket for every authenticated user
- **file:line** `backend/app/core/rate_limit.py:153`
- **Attacker:** One authenticated dispatcher (or driver) consuming `TRIP_CREATE` (10/min) or `ARTIFACT_UPLOAD` (30/min) locks every other user of the deployment out of that route for the rest of the window.
- **Attack path:** The identity is `authorization[7:][:64]`. A Supabase ES256 JWT begins with the base64url of `{"alg":"ES256","kid":"<uuid>","typ":"JWT"}`, about 95 characters that are identical for every token signed by the same key; even without `kid` the header plus the start of the payload (`{"iss":"https://<project>.supabase.co/auth/v1",…`) exceeds 64 characters. So all legitimate tokens map to the same Redis key per budget (`:76-83`). The comment "the leading 64 chars are already unique per session" is wrong for JWTs.
- **Preconditions:** Supabase-issued JWTs (the only accepted kind).
- **Confidence:** Likely (depends on Supabase's header layout, which I could not fetch; the arithmetic holds for any JWT with a `kid`).
- **Suggested fix:** Key on the verified `sub` claim, or hash the full token.
- **Test that would catch it:** none exists.

### SEC-03 · Medium · idor — `POST /api/v1/trips` accepts precinct IDs owned by another organisation
- **file:line** `backend/app/orchestration/trips/creation.py:310-311,420-437`
- **Attacker:** A dispatcher in organisation A who learns a private precinct UUID of organisation B can create a trip whose stops reference B's facility, read B's precinct name and coordinates back, and anchor a journey lock to Hedera that names B's facility.
- **Attack path:** `create_trip` passes `payload.stops[].precinct_id` / `origin_precinct_id` / `destination_precinct_id` straight into `NewTrip` (`:310-325`); `persist_trip` writes `TripStop(precinct_id=spec.precinct_id)` (`:423-429`) with no `Precinct` query at all (the module never imports `Precinct`; crew is org-checked at `:83-117` but stops are not). The FK only proves existence. The name is then resolved by ID with no org filter for the driver list (`orchestration/trips/queries.py:165-170`), and the driver route endpoint selects `Precinct.latitude, Precinct.longitude` for each stop (`orchestration/trips/route.py:105`) and sends them to OpenRouteService and back to the driver. The geofence verdicts for the trip are then computed against B's fence. Contrast: `POST /trips/from-pp-manifest` does check `own org OR is_shared` (`orchestration/consignments/manifest_import.py:322-325`).
- **Preconditions:** Knowledge of a foreign precinct UUID (122 bits of entropy; not enumerable through any route I found, but UUIDs appear in shared screenshots, audit-pack PDFs and PP manifest previews).
- **Confidence:** Verified for the missing check; Likely for the data exposure path.
- **Suggested fix:** In `persist_trip`, load every stop precinct with `Precinct.organization_id == org OR Precinct.is_shared` and raise `ResourceNotFoundError` otherwise, mirroring `manifest_import._visible_to`.
- **Test that would catch it:** none exists (`tests/integration/test_trips.py` has no cross-org precinct case).

### SEC-04 · Medium · logging — Parcel Perfect session token (and MD5 login hash) can be written to logs via `httpx` exception text
- **file:line** `backend/app/api/v1/endpoints/pp.py:56-58`; also `orchestration/consignments/manifest_import.py:99-100`, `tasks/parcel_perfect.py:142-147,177-182`
- **Attacker:** Anyone with log access (hosting console, log drain) obtains a live PP `token_id`, which is the sole credential for every PP call, and on auth-call failures the `encrypted_password` MD5 hash.
- **Attack path:** `parcel_perfect/client.py:96-104` puts `token_id`, and for `Auth.getSecureToken` the `params` JSON containing `email` and `encrypted_password`, into the **URL query string**; `:107` calls `response.raise_for_status()`, and `httpx.HTTPStatusError.__str__` includes the full request URL. `pp.py:57` logs `"PP lookup failed for waybill %s: %s", waybill_number, exc` at WARNING, so any non-2xx from PP (rate limit, outage, bad token) writes the URL, token included, to the log. The same `%s exc` pattern exists in the three other call sites.
- **Preconditions:** `PP_USE_MOCK=false` and any PP HTTP error. Vendor API design forces credentials into the query string; what is fixable here is the logging.
- **Confidence:** Likely (the `httpx` message format is from my knowledge of the library, not verified in this tree).
- **Suggested fix:** Log `type(exc).__name__` and `exc.response.status_code` only, never `str(exc)`, for PP errors; wrap PP errors into `PPUnavailableError` without the message.
- **Test that would catch it:** none exists.

### SEC-05 · Medium · logging — Bearer capability tokens (handover links, audit-pack share links) are logged through `request.url.path`
- **file:line** `backend/app/main.py:178`; `backend/app/core/rate_limit.py:179-181`
- **Attacker:** Anyone with log access replays a live audit-pack share link (valid until `pack.expires_at`, which can be weeks) or a live handover link.
- **Attack path:** The public routes carry the credential in the path (`/api/v1/handover/{raw_token}/…`, `/api/v1/public/audit-packs/{token}/…`). Any uncaught exception on those routes hits `unhandled_exception_handler`, which logs `request.url.path` (`main.py:178`). Any client that trips the global per-IP limit on those routes logs the path too (`rate_limit.py:179-181`). `audit_packs/access.py:137` says "Never echo the token into logs" but these two sinks are above it. SEC-09 gives an unauthenticated way to force the 500 on the webhook route (no token there), and SEC-01 makes the 429 easy to trigger on the token routes.
- **Preconditions:** A 500 or a global 429 on a token route.
- **Confidence:** Verified.
- **Suggested fix:** Log `request.scope["route"].path` (the template, e.g. `/handover/{raw_token}/confirm`) instead of the concrete path in both places.
- **Test that would catch it:** none exists (`tests/integration/test_health.py` covers the 500 handler shape, not its log line).

### SEC-06 · Medium · authz — Dev-panel triggers write to any organisation's trip, and the panel is allowed in production by design
- **file:line** `backend/app/dev/endpoints/triggers.py:472` (`select(Trip).where(Trip.id == body.trip_id)`), `:246-275` (`/dev/scans`), `:335-360` (`/dev/scans/close-session`), `:377-400` (`/dev/pp/waybill`), `:501-509` (`/dev/mock-state/flush`); `backend/app/main.py:140-146`; `core/config_validation.py:11-14`
- **Attacker:** Any authenticated dispatcher (not admin) of organisation A fabricates warehouse scans, PP waybill changes and exceptions (raised in the name of the trip's current driver, `:481-487`) on organisation B's trip, and flushes every organisation's mock state.
- **Attack path:** `main.py:145` mounts the router whenever `DEV_PANEL_ENABLED` is true, explicitly also under `ENVIRONMENT=production` ("the deployed demo … needs this panel"). Each route requires only `get_current_dispatcher`. `/dev/trips` (`:98`) is org-filtered, but `/dev/exceptions` loads the trip by ID alone (`:472`), `/dev/scans` and `/dev/scans/close-session` only check that the stop belongs to the trip (`orchestration/consignments/scans.py:105`), and `/dev/pp/waybill` looks the consignment up by `trip_id` and reference only (`:390-395`). Scans and exceptions feed phase gating and the exception ledger, i.e. the evidence record.
- **Preconditions:** `DEV_PANEL_ENABLED=true` (default false) and the relevant `*_USE_MOCK=true` (default true). Multi-tenant deployment.
- **Confidence:** Verified.
- **Suggested fix:** Filter every dev trigger by `Trip.operator_organization_id == current_user.organization_id`, require `require_admin_dispatcher`, and add `DEV_PANEL_ENABLED` to `collect_production_config_errors` as a warning at least.
- **Test that would catch it:** none exists (`tests/integration/test_dev_triggers.py` has no cross-org case).

### SEC-07 · Medium · config — Mock integrations default on and are not refused in production, so evidence can claim verification that never ran
- **file:line** `backend/app/core/config.py:57,60,65,73`; `backend/app/integrations/idvs.py:220-231`; `backend/app/core/config_validation.py:90-113`
- **Attacker:** Not an attacker as such: a production deploy that forgets `IDVS_USE_MOCK=false` (the default is `True`) lets every receiver reach `VERIFIED` at tier `DOCUMENT_AND_FACE` with no document or face ever checked, because `MockIdvsClient.get_decision` returns `APPROVED` for any unstaged session. The same default makes Pulsit corroboration and PP sync run against Redis fixtures.
- **Attack path:** `get_idvs_client()` (`idvs.py:364-369`) selects the mock on the default; `resolve_verdict` maps `APPROVED` + `identity_match=None` to `VERIFIED` (`receiver_verification.py:200-210`); the audit pack then prints that tier. `collect_production_config_errors` only validates the live credentials *when the mock is off* (`:90-113`); it never refuses `IDVS_USE_MOCK`/`PULSE_USE_MOCK`/`PP_USE_MOCK`/`SCAN_FEED_USE_MOCK` being true in production.
- **Preconditions:** `ENVIRONMENT=production` with any `*_USE_MOCK` left at its default.
- **Confidence:** Verified (code), Likely (operational).
- **Suggested fix:** In production, require each `*_USE_MOCK` to be explicitly set (`model_fields_set`, as done for `RATE_LIMIT_TRUST_PROXY_HEADERS` at `:118`) and refuse `IDVS_USE_MOCK=true` unless `DEV_PANEL_ENABLED` is also true; stamp mock-derived verdicts with a visible `provider="mock"` instead of `didit` (`receiver_verification.py:48,316,344`).
- **Test that would catch it:** `tests/unit/test_config_validation.py` (extend).

### SEC-08 · Low · webhook — `X-Timestamp` is not covered by the HMAC, so a captured delivery can be replayed with a fresh timestamp
- **file:line** `backend/app/orchestration/handover/receiver_verification.py:546-547,550-579`; `api/v1/endpoints/handover.py:438-451`
- **Attacker:** Someone holding a previously valid signed body replays it indefinitely by setting `X-Timestamp` to now.
- **Attack path:** The HMAC is over `raw_body` only (`:546`); the freshness check reads a separate unsigned header (`:565`). Replay reaches `ingest_webhook_decision`, which is idempotent: a non-PENDING row only gets `late_decision_*` overwritten (`:618-627`), and a PENDING row for that session resolves as the vendor said. So the replay cannot change a verdict; it can only re-apply one or churn the annotation columns.
- **Preconditions:** `IDVS_USE_MOCK=false`, a captured delivery.
- **Confidence:** Verified.
- **Suggested fix:** Sign `f"{timestamp}.{body}"` (or adopt Didit's `X-Signature-V2` once a real delivery is captured) and keep a short-TTL seen-signature set in Redis.
- **Test that would catch it:** `tests/integration/test_receiver_verification_webhook.py` (extend).

### SEC-09 · Low · input — Non-ASCII `X-Signature` makes the webhook 500 instead of 401
- **file:line** `backend/app/orchestration/handover/receiver_verification.py:547`
- **Attacker:** An unauthenticated caller sends `X-Signature: é…`; Starlette decodes headers as latin-1, `hmac.compare_digest` raises `TypeError` on a non-ASCII `str`, nothing catches it, and the request lands in the global 500 handler (which logs the path, SEC-05; harmless here as the webhook path carries no token).
- **Preconditions:** `IDVS_WEBHOOK_SECRET` set (otherwise `:543` returns before the compare).
- **Confidence:** Likely.
- **Suggested fix:** Compare bytes: `hmac.compare_digest(expected.encode(), presented.encode("latin-1", "ignore"))`, or reject non-hex signatures first.
- **Test that would catch it:** `tests/integration/test_receiver_verification_webhook.py` (extend).

### SEC-10 · Low · secrets — `SUPABASE_SERVICE_ROLE_KEY` is a required `core/config.py` field, against the project rule
- **file:line** `backend/app/core/config.py:51`; used at `storage/supabase_storage.py:52,139-140` and `integrations/supabase_admin.py:31-32,80-81`
- **Attacker:** Compromise of the API process or its environment yields the Supabase super-user key (bypasses RLS, full Storage and Auth admin). CLAUDE.md states the service_role key "never appears in code or config"; it appears in config and every storage read/sign/upload uses it.
- **Preconditions:** Process or env compromise.
- **Confidence:** Verified (policy divergence; no value is hardcoded, `.env.example` holds the key name only).
- **Suggested fix:** Scope storage to a dedicated bucket-limited key or Storage RLS policy with the anon/JWT path, keep the service key only for the Auth admin provisioning call, and either amend CLAUDE.md or the code so they agree.
- **Test that would catch it:** none applicable.

### SEC-11 · Low · config — Production safety checks hinge on the exact string `"production"`; `DEMO_MODE` guard hinges on the default `"development"`
- **file:line** `backend/app/core/config.py:108,165`; `core/config_validation.py:56`; `auth/dependencies.py:324-329`; `main.py:62,74-76`
- **Attacker:** A deploy with `ENVIRONMENT=prod`, `staging` or `Production` skips every production precondition (CORS `*`, loopback receiver URL, rate limiting, proxy trust) and serves `/docs`, `/redoc`, `/openapi.json`. `DEMO_MODE` is correctly refused outside `{development, test}`, so an auth bypass needs the default or `test` value plus `DEMO_MODE=true`.
- **Confidence:** Verified.
- **Suggested fix:** Make `ENVIRONMENT` a `Literal["development","test","staging","production"]` and treat everything except `development`/`test` as production for the checks.
- **Test that would catch it:** `tests/unit/test_config_validation.py` (extend).

### SEC-12 · Low · exposure — Unauthenticated `/health` discloses environment and version; CORS allows all methods and headers with credentials
- **file:line** `backend/app/main.py:268-298` (`environment`, `version`, probe exception class names); `main.py:92-98` (`allow_methods=["*"]`, `allow_headers=["*"]`, `allow_credentials=True`); `core/config_validation.py:63-68` (`*` origin refused only in production)
- **Attacker:** Fingerprinting; nothing more. Origins are an explicit list so the credentials+wildcard-origin combination cannot occur in production.
- **Confidence:** Verified.
- **Suggested fix:** Drop `environment` from the public body (keep in logs); enumerate methods and headers.
- **Test that would catch it:** `tests/integration/test_health.py`, `tests/unit/test_cors_origins.py`.

### SEC-13 · Low · deps — Pinned packages with public CVEs
- **file:line** `backend/requirements.txt:4,23,24`
- **Findings (confident):**
  - `python-jose[cryptography]==3.3.0` (`:23`): CVE-2024-33663 (algorithm confusion with ECDSA public keys, fixed 3.4.0) and CVE-2024-33664 (JWE decompression bomb, fixed 3.4.0). Mitigated here: `algorithms=["ES256"]` is pinned and the key is a JWK from Supabase's JWKS (`auth/dependencies.py:139-144`), and JWE is not used. Upgrade anyway.
  - `python-multipart==0.0.9` (`:24`): CVE-2024-53981 (DoS via excessive logging on malformed multipart, fixed 0.0.18). Reachable from the driver upload routes (authenticated).
  - `gunicorn==22.0.0` (`:4`): CVE-2024-6827 (Transfer-Encoding request smuggling, fixed 23.0.0). Not reachable: the Dockerfile `CMD` runs uvicorn (`Dockerfile:49`); gunicorn is an unused pin.
- **Speculative:** `httpx==0.27.0`, `redis==5.0.4`, `celery==5.4.0`, `fastapi>=0.115,<0.116`, `pydantic==2.14.0`: no CVE I can cite with confidence.
- **Confidence:** Likely (from memory; not web-checked per instructions).
- **Suggested fix:** `python-jose>=3.4`, `python-multipart>=0.0.18`, drop or bump gunicorn.
- **Test that would catch it:** none (CI dependency audit would).

### SEC-14 · Low · popia — A live handover capability token is handed to the identity vendor as the callback URL
- **file:line** `backend/app/integrations/idvs.py:316-319`; `orchestration/handover/receiver_verification.py:438-440`; `handover/capability.py:435-441`
- **Attacker:** Didit (or anyone reading its logs/redirect history) holds the receiver's live link for its lifetime (up to 20 min after extension). Mitigation already in place: redemption also requires the HttpOnly `fp_handover_session` cookie (`handover.py:271`), so the vendor-held URL renders a scan page but cannot confirm. The trade-off is documented at `receiver_verification.py:408-412`.
- **Confidence:** Verified.
- **Suggested fix:** Pass a one-time return nonce in the callback instead of the raw token, resolved server-side to the token.
- **Test that would catch it:** none applicable.

### SEC-15 · Low · idor — PP waybill lookup and "already assigned" check are not organisation-scoped
- **file:line** `backend/app/api/v1/endpoints/pp.py:42-76`; `orchestration/consignments/sync.py:368-387`; `orchestration/consignments/waybill_lookup.py:9-28`; `core/exceptions.py:169-186`
- **Attacker:** Any authenticated dispatcher in any organisation enumerates PP waybill numbers and receives `customer_name`, `dest_person` (a natural person's name) and `declared_value` from the shared PP account, plus the `trip_reference` of whichever organisation's trip already holds that waybill (`sync.py:381-386` joins `Trip` with no org filter). `ConsignmentAlreadyAssignedError` likewise embeds the other trip's reference in its message (`exceptions.py:182-185`) which `trips.py:119-120` returns as `detail`.
- **Preconditions:** Multi-organisation deployment sharing one PP account.
- **Confidence:** Verified.
- **Suggested fix:** Add `Trip.operator_organization_id == org` to `get_assigned_trip_reference` and return a boolean rather than the foreign reference; consider restricting `dest_person` to the manifest path.
- **Test that would catch it:** `tests/integration/test_pp_endpoints.py` (extend).

### SEC-16 · Low · exposure — Every dispatcher can list every driver's national ID number, phone and licence number
- **file:line** `backend/app/api/v1/endpoints/drivers.py:33-38,103-119`; `schemas/people.py:57-59`
- **Attacker:** A non-admin dispatcher account compromise yields the full personal-data set for the organisation's drivers. `GET /drivers` and `GET /drivers/{id}` return `DriverRead` with `id_number`, `phone_number`, `license_number`; mutation is admin-only, reading is not. The `is_shared`-precinct model shows the codebase already has a notion of narrower reads.
- **Confidence:** Verified.
- **Suggested fix:** Return a `DriverSummary` (name, id, active, licence expiry) from the list and keep identifiers on the admin-only detail.
- **Test that would catch it:** `tests/integration/test_drivers.py` (extend).

### SEC-17 · Low · input — No request-body size cap for JSON bodies or the webhook raw body
- **file:line** `backend/app/api/v1/endpoints/handover.py:435`; `backend/app/main.py` (no body-size middleware); `Dockerfile:49` (uvicorn has no body limit)
- **Attacker:** An unauthenticated caller streams a multi-gigabyte body to `/handover/webhooks/didit` (read fully before the signature check) or to any JSON route; Pydantic/`json.loads` materialise it in memory. Uploads are bounded (10 MiB, `artifacts.py:66-77`; 512 KiB signature, `schemas/handover.py:19-20`), JSON bodies are not.
- **Preconditions:** No reverse proxy limit in front (Railway's edge limits are not visible from the repo).
- **Confidence:** Verified (absence).
- **Suggested fix:** A small middleware that rejects `Content-Length` above 1 MiB on non-upload routes and reads bodies with a cap.
- **Test that would catch it:** `tests/unit/test_input_limits.py` (extend).

### SEC-18 · Low · authn — JWKS refetch is forced by any unknown `kid`, synchronously, on the event loop
- **file:line** `backend/app/auth/dependencies.py:86-118,136`
- **Attacker:** An unauthenticated caller sends a token whose header carries a random `kid`; `_get_signing_key` misses the cache and performs a blocking `urllib.request.urlopen` to Supabase on every such request (`:107-110`), inside an `async def` dependency, stalling the worker for up to 10 s per call and hammering the JWKS endpoint. Also noted: `issuer` is not verified (`:139-144`), acceptable because the key set itself comes from the configured Supabase project.
- **Confidence:** Verified.
- **Suggested fix:** Rate-limit forced refreshes (e.g. at most once per 60 s), and fetch with `httpx.AsyncClient` or `asyncio.to_thread`.
- **Test that would catch it:** `tests/unit/test_auth_jwks_cache.py` (extend).

### SEC-19 · Info · logging — Personal data and token fragments in log lines
- `backend/app/core/rate_limit.py:104-107,158`: logs `identity`, which is the first 64 characters of the bearer token (header + payload start; not the signature).
- `backend/app/integrations/supabase_admin.py:98`: logs a dispatcher's full email on duplicate (function has no caller under `app/`; used by `scripts/`).
- `backend/app/orchestration/consignments/sync.py:199-202`, `tasks/parcel_perfect.py:109-114`: log PP `custname`.
- `backend/app/integrations/supabase_admin.py:52-54,103-105`: log the vendor error body, which may echo the phone/email submitted.
- Confidence: Verified. Fix: log IDs and exception class names only.

### SEC-20 · Info · authn — Missing credentials answer 403, not 401; SSE stream outlives the idle timeout
- `backend/app/auth/dependencies.py:207-211,276-280` return 403 "Missing authentication credentials" (should be 401 with `WWW-Authenticate`). `api/v1/endpoints/stream.py:78-86` checks the session once at connect; an open SSE connection keeps streaming org events after `SESSION_IDLE_TIMEOUT_MINUTES`. Confidence: Verified.

### SEC-21 · Info · exposure — Public seal route is reachable by pack UUID alone, by design
- `backend/app/api/v1/endpoints/audit_packs_public.py:112-122` → `access.py:235-240`. Returns pack label (which embeds the trip reference), hashes and anchor status for any pack whose UUID is known; the UUID is printed on every issued PDF. No evidence is exposed. Confidence: Verified. Note only.

### SEC-22 · Info · popia — Pre-image payloads hash low-entropy personal fields without a salt
- `backend/app/orchestration/fleet/drivers.py:105-107` (`license_number_sha256`), `orchestration/fleet/canonical.py:29-34` (`pulsit_device_id_sha256`). These live in `BlockchainReceipt.payload_json` in PostgreSQL, not on Hedera (only the top-level digest is anchored), so there is no on-chain exposure. If `payload_json` is ever shown outside the organisation, licence numbers become dictionary-attackable. Confidence: Verified. Note only.

### SEC-23 · Info · config — `ENVIRONMENT`-independent `DEV_PANEL_ENABLED` is documented as deliberate
- `backend/app/core/config_validation.py:11-14`, `dev/endpoints/triggers.py:61-74`. Recorded so SEC-06's precondition is understood as a product decision, not an oversight.

### SEC-24 · Info · authz — Document divergence: CLAUDE.md "Receiver = one-time OTP" / "Guard page = zero login"
- The reviewed backend has no guard route at all and the receiver flow is a rotating 256-bit capability token + HttpOnly binding cookie + optional vendor ID check, not an OTP. Both are stronger than the documented model; CLAUDE.md should be updated so future reviews do not look for an OTP that does not exist.

### SEC-25 · Info · input — Pagination cursor is unsigned but safely parsed
- `backend/app/core/pagination.py:53-95`: base64 JSON, length-capped, strict key set, typed `datetime`/`UUID`, bound as parameters. No action.

---

## Question-by-question answers

**A. Authentication.** Algorithms pinned to `["ES256"]`, audience `authenticated` checked, `exp` checked by `python-jose` defaults, secret source is the Supabase JWKS at `settings.SUPABASE_URL` (no hardcoded key), `sub` must be a UUID with a live DB row, role from `app_metadata` only (`auth/dependencies.py:121-192`). `none`/HMAC confusion is excluded by the algorithm list. Issuer is not checked (SEC-18 note). Refresh tokens are opaque Supabase strings and cannot pass; there are no OTP tokens on this tree. Unauthenticated routes are listed below and each is intentional per the code comments; CLAUDE.md's "receiver OTP" wording is stale (SEC-24). Routes whose availability depends on settings: all `/api/v1/dev/*` (`DEV_PANEL_ENABLED`, plus `PULSE_USE_MOCK` for pulsit/tracker), `/docs`/`/redoc`/`/openapi.json` (non-production), and every route under `DEMO_MODE` (development/test only).

**B. Authorisation.** Dispatcher routes use `get_current_dispatcher` or `require_admin_dispatcher`; role checks are deny-by-default (`DispatcherRole(raw)` raises on anything unexpected, `:166-178`). Every dispatcher route taking a trip, driver, vehicle, precinct, exception, pack, substitution or receipt ID that I traced filters on `operator_organization_id`/`organization_id` (trips `detail.py:111`, substitutions `reads.py:71-73`, exceptions `review.py:75-76`, blockchain `subject_visibility.py:206-221`, audit packs `lifecycle.py:246`, artifacts `evidence/artifacts.py:326`, fleet `fleet/*.py`). Driver routes resolve custody via `substitutions/access.py:255-291` (participant check, then current holder) so a stranger gets 404 and a former driver gets the coded 409. Gaps: SEC-03 (precinct IDs on trip creation), SEC-06 (dev triggers), SEC-15 (PP lookup). The guard page does not exist in the backend. Non-admin dispatchers are stripped of `blockchain_receipts` and driver `receipts` in the handler (`trips.py:416-417`, `drivers.py:117-118`).

**C. OTP and receiver verification.** The receiver has no OTP; the credential is a 256-bit `secrets.token_urlsafe` token hashed with SHA-256 and matched by indexed equality (`capability.py:40-41,77,132-135`), single-use via a conditional `UPDATE … WHERE redeemed_at IS NULL AND expires_at > now()` (`:160-171`), expiring (`HANDOVER_TOKEN_EXPIRY_MINUTES`, one extension), bound to the first browser by an HttpOnly, SameSite=strict cookie compared with `secrets.compare_digest` (`:305-316`), and every attempt is logged to `handover_token_attempts`. Tokens are per phase event, so reuse across trips is impossible (`:145-157` reject wrong trip/stop). The only real OTP is the audit-pack email code: 6 digits from `secrets.randbelow`, 10-minute TTL, 5 failed attempts per code, 60 s resend cooldown, 5 codes per hour per pack, pack-salted hash, `compare_digest`, single-use (`email_codes.py:32-43,155-179`). Unauthenticated callers can trigger email sends only with a valid share token and within those caps; there is no SMS (Twilio is unimplemented). The per-IP layer on top is bypassable (SEC-01).

**D. Webhooks.** One handler, `POST /api/v1/handover/webhooks/didit` (`handover.py:419-460`). Signature is verified over the raw bytes **before** parsing (`:435-442`), HMAC-SHA256 with `hmac.compare_digest` (`receiver_verification.py:546-547`), secret from `settings.IDVS_WEBHOOK_SECRET`, fails closed when unset (`:542-544`) and refused at startup in production when live IDVS is on (`config_validation.py:107-113`). Replay protection is a ±300 s timestamp window on an **unsigned** header (SEC-08); idempotency comes from row state. No nonce store. `pp.py` is not a webhook.

**E. Input handling.** No raw SQL from strings (only the constant `text("SELECT 1")` and constant index predicates); no `pickle`, `yaml`, `eval`, `exec`, `subprocess`. Storage keys are server-generated UUIDs (`supabase_storage.py:76,225`); stored keys are validated against `.`/`..`/empty before URL building (`:116-132`). No user-influenced outbound host: every base URL is a config field or a Hedera mirror constant. Uploads: declared size then real size against 10 MiB, magic-byte sniffing of JPEG/PNG/WebP/HEIC/PDF with SVG deliberately absent, declared type must agree with sniffed (`mime_allowlist.py`). Gaps: no JSON/webhook body cap (SEC-17), `compare_digest` TypeError (SEC-09).

**F. Data exposure.** The 500 handler returns a constant body (`main.py:179-182`); `/health` returns exception class names only. `detail=str(exc)` is used widely for domain errors, but every such exception class I read carries IDs, references or constant text, never SQL or stack traces; `PPUnavailableError` and Hedera errors are mapped to constant strings in `trips.py:98-140`. `HandoverRedemptionResult.reason` is never surfaced (one 404 string). Residual: SEC-15 (foreign trip reference and PP customer names), SEC-16 (driver identifiers to all dispatchers), SEC-12 (`/health` environment).

**G. Personal data and POPIA.** Hedera receives only the 64-hex digest (`hedera.py:26,98,175-187`); verified end to end, no memo, no payload. Outbound personal data: driver phone and full name to Supabase Auth admin (the identity provider the data belongs to); recipient email, a code and the pack label to SendGrid (outside SA, documented, body contains no trip data, tracking off); facility coordinates to OpenRouteService (never driver/truck positions); tracker device IDs to Pulsit; `verification.id`, `workflow_id` and the callback URL to Didit (SEC-14) — the receiver's document and face go browser-to-vendor under recorded consent (`receiver_verification.py:293-322`). Typed name and ID number are compared in memory and only `identity_match` is stored (`:497-505`). Logs: SEC-04, SEC-05, SEC-19. Nothing personal leaves to a party it does not belong to.

**H. Secrets and configuration.** No hardcoded secrets in `app/` (grep for secret-shaped literals returned nothing but a header name); `.env.example` populates only non-secret values and leaves every key empty. `DEBUG`/`reload` do not appear. CORS origins are an explicit list. Dev routes: SEC-06/SEC-23. `DEMO_MODE`: refused outside development/test. Service-role key: SEC-10. Environment string handling: SEC-11.

**I. Dependencies.** SEC-13.

---

## Unauthenticated routes (all `/api/v1` unless noted) and whether they are meant to be

| Route | Intended? | Credential |
|---|---|---|
| `GET /health` | yes (orchestrator probe) | none |
| `GET /handover/{raw_token}` | yes (FP-239, receiver has no account) | capability token |
| `POST /handover/{raw_token}/confirm` | yes | token + HttpOnly cookie |
| `POST /handover/{raw_token}/consent` | yes | token |
| `POST /handover/{raw_token}/verify` | yes | token (spends vendor quota, 5/min/IP) |
| `POST /handover/{raw_token}/verify/resolve` | yes | token |
| `POST /handover/webhooks/didit` | yes | HMAC signature |
| `GET /public/audit-packs/seal/{pack_id}` | yes (printed on PDFs) | pack UUID only |
| `GET /public/audit-packs/{token}` | yes (FP-291 share link) | share token (+ emailed-code grant when the pack has a recipient email) |
| `GET /public/audit-packs/{token}/pdf` | yes | same |
| `GET /public/audit-packs/{token}/incident-sheet.pdf` | yes | same |
| `GET /public/audit-packs/{token}/artifacts/{artifact_id}` | yes (artifact must be in the pack manifest) | same |
| `POST /public/audit-packs/{token}/verify` | yes | same |
| `POST /public/audit-packs/{token}/email-code` | yes | share token |
| `POST /public/audit-packs/{token}/email-code/verify` | yes | share token + code |
| `/docs`, `/docs/oauth2-redirect`, `/redoc`, `/openapi.json` | non-production only | none |
| `GET /trips/{trip_id}/manifest` | authenticated, but inline (`manifest.py:31-46`) rather than via `Depends` | dispatcher or driver JWT |

CLAUDE.md's "guard page (zero login)" has no backend route on this tree.

## Coverage

- Routes: **127 of 127** inventoried and checked for an auth dependency (worker inventory, independently grep-verified by me). Ownership scoping traced end to end by me for the trips, handover, audit-pack (public and dispatcher), driver-substitution, driver, blockchain, artifact, exception, PP, manifest and dev-trigger routes; the analytics, vehicle, precinct, cost-profile, location, checkpoint and phase routes were verified at the handler level (org/driver ID passed from the token) with the service-level scoping taken from the worker inventory and spot-checked.
- Files read by me (≈68, about 45 in full): `auth/{dependencies,sessions,router,profile}.py`; `core/{config,config_validation,security_headers,client_ip,rate_limit,limits}.py`, `core/exceptions.py` (grep), `core/pagination.py` (decoder); `main.py`; `dev/endpoints/{triggers,pulsit,tracker}.py` (guards, trip loading, org scoping); `api/v1/endpoints/{handover,audit_packs_public,artifacts,driver_substitutions,trips,drivers,blockchain,stream,manifest,pp}.py` in full, `{exceptions,audit_packs,locations,checkpoints,parcels,precincts,vehicles,trip_admin,analytics,fleet_analytics,cost_profile,phases}.py` at decorator/dependency level; `orchestration/handover/{capability,receiver_verification,service}.py`; `orchestration/audit_packs/{email_codes,access}.py` (partial); `orchestration/substitutions/{access,reads,notices}.py` (scoping functions); `orchestration/trips/{creation,queries,route,detail}.py` (scoping); `orchestration/consignments/{sync,waybill_lookup}.py` (partial); `orchestration/evidence/artifacts.py` (partial); `orchestration/fleet/drivers.py` (partial); `integrations/{idvs,sendgrid,supabase_admin}.py`, `integrations/pulsit.py` (live client), `integrations/parcel_perfect/client.py` (auth and call path); `storage/{supabase_storage,mime_allowlist}.py`; `blockchain/{hedera,anchor_service,critical_fields,subject_visibility}.py`; `schemas/{handover,people,pp,trips}.py` (constraints); `requirements.txt`, `.env.example` (key names), `Dockerfile` (CMD and proxy comments), `pytest.ini`/`tests/conftest.py` (grep), test file names; `CLAUDE.md`; `graphify-out/GRAPH_REPORT.md` (skim).
- Not covered: `integrations/routing.py`, `scan_feed.py`, `mock_state.py` and the PP `mock.py`/fixtures (worker summary only); `core/realtime.py`, `core/geo.py`, `core/polygon.py`, `core/demo_waypoints.py`, `core/phase_meta.py`, `core/display.py`, `core/constants.py`; `dev/schemas.py` and `dev/services/*`; `blockchain/__init__.py`; the Hedera payload builders in `crypto/hashing.py`, `phases/payloads.py`, `evidence_anchors/canonical.py`, `substitutions/canonical.py`, `fleet/canonical.py` (taken from the worker's field list, consistent with my reading of `anchor_service.py`); `reporting/*`; `tasks/*`; `db/models/*`; all tests' contents; frontends and `shared/`; the `dev`-only analytics-chat code.

## Suggested order of work

1. SEC-01/02 (rate-limit identity) — one small change in `rate_limit.py`.
2. SEC-05 and SEC-04 (tokens and PP credentials in logs) — two-line fixes each.
3. SEC-03 (precinct ownership on `POST /trips`) — reuse `manifest_import._visible_to`.
4. SEC-06 and SEC-07 (dev panel scoping, mock flags in production) — config validation plus org filters.
5. SEC-13 dependency bumps.
6. The Lows as hygiene.
