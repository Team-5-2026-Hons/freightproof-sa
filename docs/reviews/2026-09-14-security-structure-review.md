# Security and structure review — 14 September 2026

**Verdict:** the broad architecture is sensible, but there are security defects to fix before treating this as ready for real customer evidence. Prioritize access boundaries and evidence integrity over a general folder refactor.

## Scope and evidence

- Checkout: `ciaran`, `a117f4bee6fdda7470437b9251fb6c307ae42be4`.
- Refreshed `origin/dev`: `6332f9ca395fea2984d6fae9a296d1b886baac2c`. It is **not identical** to the checkout: it includes the receiver app, handover routes and live analytics views.
- Started from the 13 September Graphify report and queried its graph, then read source. The graph predates the latest dev changes, which were inspected directly with Git.
- Read the security-sensitive implementation in both versions. Tested selected backend code from a temporary snapshot of **origin/dev**, with no environment files and dummy configuration. Common finding locations below were checked against dev; dev-only changes are identified explicitly.
- Inventoried authentication across the endpoint modules, then traced authorization, artifacts, sessions, upload processing, handover, migrations, browser persistence and request wrappers. Manifest authentication is explicitly handled inside the endpoint; it is not public despite lacking a conventional auth `Depends` parameter.
- UI/UX excluded. Application code and existing working-tree changes untouched.

This is a source review with isolated reproductions, not a deployed penetration test or proof that every path is safe. Production database privileges, storage policies, reverse-proxy limits, Auth settings and runtime versions were not inspected. No live account, partner service or production data was used.

## Prioritized security findings

### S1 — Urgent deployment check: newer tables lack migration-enforced Data API protection

**Impact:** potentially critical if the exposed schema retains broad `anon`/`authenticated` grants; deployment exposure is not confirmed.

The original RLS migration protects a fixed list of tables. Later migrations create these without enabling RLS or revoking Data API access:

| Table | Creation migration |
| --- | --- |
| `vehicle_events`, `driver_events` | `2026_05_17_ciaran_add_vehicle_driver_events.py` |
| `trip_stops` | `2026_06_24_ciaran_add_tripstop.py` |
| `driver_sessions` | `2026_08_05_tim_add_driver_sessions.py` |
| `trip_location_pings` | `2026_08_05_tim_add_trip_location_pings.py` |
| `user_sessions` | `2026_08_10_tim_add_user_sessions.py` |
| `precinct_events` | `2026_08_31_ciaran_add_precinct_events.py` |
| `handover_capability_tokens`, `handover_token_attempts` | `2026_09_10_tim_add_handover_capability_tokens.py` |
| `handover_confirmations` (dev) | `2026_09_13_tim_add_handover_confirmations.py` |

**Attack path:** if those roles have the usual Data API privileges, a caller can bypass FastAPI and read location/session data or modify evidence/session state directly. Hashing capability tokens does not protect a table that callers can update.

See the [handover table migration](/Users/ciaranformby/dev/freightproof-sa-4/backend/migrations/versions/2026_09_10_tim_add_handover_capability_tokens.py:40) and [location table migration](/Users/ciaranformby/dev/freightproof-sa-4/backend/migrations/versions/2026_08_05_tim_add_trip_location_pings.py:27). The new analytics migrations explicitly revoke access; apply that discipline consistently. The renamed `phase_events` table inherits its original RLS and is **not** included in this finding.

**Fix:** inspect `pg_class.relrowsecurity`, table privileges and exposed schemas using a read-only query. For backend-only tables, revoke access from `anon` and `authenticated`, enable RLS with no client policies, or move them to a private schema. Add a migration test running as the actual API roles, not the table owner. [Supabase explains why SQL-created tables require explicit RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### S2 — High: driver can bypass receiver confirmation

**Attack path:** an assigned driver uploads an ordinary artifact to their own trip, then submits its ID as `pod_signature_artifact_id` to the phase-completion endpoint, without any receiver scanning or confirming.

[advance_confirmation](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/orchestration/phase_service.py:1559) only verifies trip ownership of the supplied artifacts. It never queries `HandoverConfirmation` or matches the signature to the confirmation phase. This function is unchanged in dev even though dev replaces the driver signature step with receiver QR handover. The browser step is therefore the only enforcement of receiver participation. See also the [receiver handover routes on the reviewed dev commit](https://github.com/Team-5-2026-Hons/freightproof-sa/blob/6332f9ca395fea2984d6fae9a296d1b886baac2c/backend/app/api/v1/endpoints/handover.py).

**Verified:** executed the real confirmation function and its artifact check with a fake database containing the supplied trip artifact; it reached `COMPLETED` with no receiver-record query. Phase gating, external corroboration, anchoring and final persistence were mocked. Source inspection also found no receiver check in the upstream phase gate.

**Fix:** require a confirmed handover for that exact trip and phase, and obtain the signature artifact from that record server-side. Reject a caller-supplied mismatch. If historical trips need an older workflow, give it an explicit, server-controlled eligibility rule and audit trail.

### S3 — High: upload parsing is exposed before authentication and has vulnerable dependencies

**Attack path:** an unauthenticated caller posts oversized or adversarial multipart bodies to `/api/v1/artifacts`, consuming parsing CPU, memory and temporary disk before being rejected.

The size check in [artifacts.py](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/api/v1/endpoints/artifacts.py:46) runs after FastAPI has parsed the multipart request. `UploadFile.size` is the parsed file size, not an early header-based gate. The global request-count limit is not a byte or concurrency limit.

**Verified:** with the installed FastAPI/Starlette stack, an isolated route with the same upload/dependency arrangement parsed an 11 MiB file before its rejecting authentication dependency ran. The repo pins `python-multipart==0.0.9` and FastAPI `<0.116` in [requirements.txt](/Users/ciaranformby/dev/freightproof-sa-4/backend/requirements.txt:2); the tested environment has Starlette `0.46.2`. The audit identifies multipart parsing DoS advisories, including GHSA-59g5-xgcq-4qw3 and [Starlette's multipart rollover advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-2c2j-9gv5-cj73). No malicious flood was sent to a server.

**Fix:** upgrade FastAPI/Starlette and python-multipart together to compatible patched versions; enforce total request bytes before multipart parsing, including chunked requests; configure matching ingress limits and bounded upload concurrency. Keep service-level file-size and MIME checks too. A proxy limit might already reduce deployed exposure, but was not verified.

### S4 — High: unverified JWT prefixes share and exhaust other users' rate limits

**Attack path:** send ten invalid tokens with the common JWT header prefix to exhaust the trip-creation bucket for legitimate users sharing that prefix.

[rate_limit.py](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/core/rate_limit.py:187) uses only the first 64 token characters. Those commonly encode the same algorithm/key ID across an entire Supabase project, not the user or session. The decorator dependency runs before endpoint authentication.

**Verified:** an isolated FastAPI route using the actual limiter accepted ten requests into the counter before returning 401, then returned 429 for a different synthetic subject. All eleven requests used one counter. Existing tests use short distinct strings such as `token-abc`, which miss realistic JWT collisions.

**Fix:** retain the pre-authentication IP limit, but apply authenticated budgets using the verified principal's stable ID. Public handover endpoints must explicitly use an IP budget, regardless of an arbitrary Authorization header. Hashing the whole token would remove prefix collisions but still would not implement a stable per-account limit.

### S5 — Medium: arbitrary signing-key IDs trigger blocking network requests

**Attack path:** submit tokens containing unknown `kid` values, forcing synchronous Supabase requests on the API event loop without possessing a valid signature.

[_get_signing_key](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/auth/dependencies.py:102) refreshes on every cache miss; [_fetch_jwks](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/auth/dependencies.py:86) uses synchronous `urlopen` with a ten-second timeout. The one-hour cache does not stop unknown-key refreshes.

**Verified:** five unknown IDs caused five mocked network fetches despite a fresh cache. Actual Supabase latency and production worker impact were not load-tested.

**Fix:** use an async, bounded client; coordinate refreshes; apply a refresh cooldown and bounded negative caching; retain bounded key-rotation recovery. Check the algorithm/header shape before fetching. Add a test for many different unknown IDs, not only a legitimate rotation.

### S6 — Medium: checkpoints can reference another trip's artifacts

**Attack path:** an assigned driver who knows an artifact UUID from another trip attaches it to their checkpoint, creating a false evidence association.

[checkpoint_service.py](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/orchestration/checkpoint_service.py:47) copies both artifact IDs directly. The foreign keys prove existence, not trip ownership. Phases and exceptions already enforce this additional boundary.

**Verified:** the real checkpoint function accepted the supplied IDs with only the trip query; no artifact lookup occurred. Fake persistence and output validation were used. This establishes an integrity gap, not a demonstrated ability to download another tenant's image.

**Fix:** extract a shared trip-scoped artifact assertion and apply it to phases, exceptions and checkpoints. Add wrong-trip tests for both checkpoint artifact fields.

### S7 — Medium: refreshed old sessions can defeat “newest login wins”

**Attack path:** a holder of an older session's still-valid refresh credentials refreshes after a newer phone signs in, then takes the driver account back without a new login.

[sessions.py](/Users/ciaranformby/dev/freightproof-sa-4/backend/app/auth/sessions.py:149) orders different sessions by JWT `iat`, including in the atomic upsert. That timestamps the access token, not the original login. [Supabase documents `iat` and `session_id` as distinct claims](https://supabase.com/docs/guides/auth/jwt-fields).

**Verified:** the actual enforcement function accepted an old session ID with a later token issue time and committed the takeover against a mocked current-session row. No real Supabase refresh was performed; provider-side revocation settings could constrain the deployed attack.

**Fix:** order session ownership using authoritative session creation/login information or a server-managed generation; revoke superseded sessions or retain a denial record. A token refresh must not promote a superseded session. Test old-login/new-login/old-token-refresh as a sequence.

### S8 — Medium: offline evidence is not isolated by signed-in account

**Attack path:** after driver A signs out on a shared handset, driver B inherits A's stored queue; replay uses B's token and can discard A's evidence on authorization errors. Local evidence also remains accessible to someone with access to that browser profile.

The queue uses a global [fp_offline_queue key](/Users/ciaranformby/dev/freightproof-sa-4/frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:116), entries contain no owner, and [signOut](/Users/ciaranformby/dev/freightproof-sa-4/frontend/driver-pwa/lib/context/AuthContext.tsx:164) does not isolate it. Draft keys likewise include trip/phase but no user. The flush loop treats 401/403 as disposable terminal failures. This is a source-traced account-switch risk; it was not exercised in a browser.

**Fix:** namespace queue/draft storage by authenticated account, check ownership before replay, and stop/preserve pending work on authentication failures. Lock or quarantine unsent evidence across logout; do not indiscriminately delete it. Define an explicit retention and recovery policy for captured photos and location data.

## Structure and semantic reuse

The existing boundaries — API schemas, orchestration, database models, integrations, storage, blockchain, and separate frontend applications with a shared library — fit this product. Keep them. Most valuable changes are small extractions at places where duplicated policy has already drifted.

| Area | Similar logic and concrete improvement |
| --- | --- |
| Artifact authorization | Phase completion has a batch trip-ownership assertion; exceptions implement a single-artifact variant; checkpoints omit it. Make one shared assertion in the artifact layer, with optional purpose/phase constraints where required. This directly addresses S6. |
| Frontend API clients | Dispatcher and driver both resolve cached tokens, bound session lookup, build headers, refresh once on 401 and parse errors. Their timeout/error handling has diverged. Share a transport with explicit timeout, FormData, retry and session-expiry policies. Keep app-specific endpoints and receiver cookie authentication separate. |
| Idle-session hooks | Both apps wrap the existing shared idle functions with nearly the same listeners, timers and cross-tab handling. Share the hook or listener lifecycle too, accepting an expiry callback. |
| Evidence persistence | Drafts, queue entries and visual-count carry each own localStorage keys and error handling. A small account-scoped storage adapter can centralize schema versions, expiry, quota results and recovery. IndexedDB is a better fit for blobs, but changing storage alone does not fix authorization or evidence loss. |
| Backend visibility | Several services perform equivalent trip/driver/org checks and differ in 403/404 handling. Introduce narrowly named loaders such as `load_trip_for_driver` and `load_trip_for_operator`, with tested semantics. Do not create a universal authorization function full of role flags. |
| Phase orchestration | `phase_service.py` combines phase gating, transitions, position projection, anchoring and per-phase evidence handlers. Extract cohesive responsibilities gradually, retaining one transition entry point and explicit phase handlers. Avoid a generic configurable workflow engine for these distinct operations. |
| Fleet mutations | Driver, vehicle and precinct services share an update/snapshot/event/anchor pattern. Reuse the repeated event/anchor plumbing only where contracts actually agree; keep each entity's validation and event meaning explicit. |

Specific starting points: [dispatcher client](/Users/ciaranformby/dev/freightproof-sa-4/frontend/dispatcher/lib/api/client.ts), [driver client](/Users/ciaranformby/dev/freightproof-sa-4/frontend/driver-pwa/lib/api/client.ts), [dispatcher idle hook](/Users/ciaranformby/dev/freightproof-sa-4/frontend/dispatcher/lib/hooks/useIdleTimeout.ts), [driver idle hook](/Users/ciaranformby/dev/freightproof-sa-4/frontend/driver-pwa/lib/hooks/useIdleTimeout.ts).

For human readability, preserve comments explaining invariants, concurrency and compatibility, but move long historical narratives to design notes. Several functions are harder to navigate because commentary substantially exceeds the code. Introduce structured error codes for replay/auth decisions instead of interpreting every 409 as duplicate success or matching prose messages.

## Other hardening and follow-up work

- Storage calls use a synchronous Supabase client inside async functions, including repeated signed-URL generation. Bound timeouts and use asynchronous calls or a bounded thread offload; batch URL signing where supported.
- The SSE stream checks authorization only at connection establishment and has an unbounded queue. Add connection lifetimes/revalidation, bounded buffering and connection limits. Events are thin, organization-scoped notifications, so this is not ranked as a demonstrated full-data leak.
- Browser CSP remains absent; add a tested deployment-appropriate policy. The checked `dangerouslySetInnerHTML` use contains a static theme script, not demonstrated attacker-controlled HTML.
- Receiver capability URLs appear in request paths. Ensure API, proxy and error logging redact those path tokens; the receiver frontend's `no-referrer` header is good but does not redact server access logs.
- Verify receiver/API hosting is compatible with the binding cookie's `SameSite=Strict` policy. `credentials: include` does not override SameSite restrictions. Verify allowed origins and HTTPS in the deployed configuration.
- Confirm real deployments disable evidence-fabrication routes and intentionally configure all mock integrations. The source defaults and flags are not evidence of deployed settings.
- Existing RLS SELECT policies and FastAPI authorization need one explicit authority model. Direct Data API reads can bypass application idle/active-user checks even when tenant RLS is correct. Prefer backend-only access where there is no client consumer.
- Offline replay still treats every 409 as already committed, although phase endpoints use 409 for blocked/early/sequence errors. Preserve those entries or reconcile against actual server state. This remains an evidence-loss issue from the earlier review; the current source still contains it.

## Dependency audit and verification results

| Check | Result and interpretation |
| --- | --- |
| Selected existing backend security tests | 55 passed, 23 skipped; skipped cases require database fixtures. |
| Review-only behavior probes | 6 passed, reproducing the current insecure behavior. These are demonstrations, not tests asserting the desired secure outcome. |
| Combined run | **61 passed, 23 skipped**, 6 python-jose deprecation warnings. |
| Dispatcher npm lock audit | 10 affected-package entries: 4 high, 4 moderate, 2 low. |
| Driver npm lock audit | 16 entries: 3 critical, 8 high, 4 moderate, 1 low. |
| Receiver npm lock audit | 2 entries: 1 high, 1 moderate. |
| Installed Python environment audit | 49 raw findings across 8 packages; duplicate advisory records reduce to 25 unique package/advisory pairs. Includes development tools. |

The Python audit describes the installed local environment, not a freshly resolved production image. The frontend audits use lockfiles from dev. Raw audit severities are **not** application exploitability scores: driver critical entries include Vitest UI/tooling and tar; no attacker-controlled production archive-extraction path was established. The multipart findings have a concrete exposed request path and are prioritized above these tooling entries. Python-jose is outdated, but the checked API restricts ES256 and does not use JWE; this review does not claim the listed JOSE advisories demonstrate an authentication bypass here.

Audit jobs currently use `continue-on-error` in [CI](/Users/ciaranformby/dev/freightproof-sa-4/.github/workflows/ci.yml:116). After triage, gate relevant production vulnerabilities; document scoped, expiring exceptions for unreachable/tooling cases. Resolve compatible updates and rerun tests rather than applying `audit fix --force` blindly.

Review probes are saved at [test_review_security.py](/tmp/freightproof-security-20260914/backend/tests/unit/test_review_security.py). They execute actual functions with mocked external dependencies; the multipart and dependency-order probes use minimal FastAPI routes. Temporary snapshot root: `/tmp/freightproof-security-20260914`. No live database, full integration suite, frontend browser run, load test, full dependency re-resolution or deployment scan was performed. Passing selected tests must not be read as security sign-off.

## Recommended order

1. Confirm and close direct Data API exposure (S1); enforce receiver confirmation server-side (S2).
2. Patch the upload stack and enforce pre-parser limits (S3); correct rate-limit identities and JWKS refresh behavior (S4–S5).
3. Centralize artifact ownership checks (S6), correct session ownership (S7), and isolate offline evidence (S8).
4. Add adversarial integration tests using two organizations, two driver sessions, foreign artifact IDs, unconfirmed handovers and actual database API roles. Convert the review demonstrations into tests asserting rejection after fixes.
5. Share transport/session/storage mechanics and extract cohesive phase responsibilities incrementally. A broad folder reshuffle can wait.
