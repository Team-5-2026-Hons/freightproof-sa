# FP-115 — Forensic View + Admin-Dispatcher Role

> Combined design + implementation plan. The design (what & why) is up top so the
> approach is defensible at examination; the phased task list (how) is below and is
> what you execute from. Iteration 2, Phase 1 — Foundations.
>
> **Ticket:** FP-115 · **Branch:** Ciaran · **Depends on Bruce:** no · **Blocks driver app:** no (dispatcher-side; do first because it applies presentation feedback and settles the shared auth layer before branches diverge).

---

## 1. Goal

Apply the post-presentation feedback: a normal dispatcher should **not** see blockchain/hash
complexity that adds nothing to their job. Introduce an **admin-dispatcher** role that can reveal
forensic detail via an opt-in toggle. The split is the iteration-2 differentiator made concrete —
operators get a clean evidence verdict; the forensic proof is there for those who need it.

## 2. Decisions (locked during brainstorming, 2026-06-13)

| # | Decision |
|---|---|
| Enforcement | **Hybrid.** Backend gates the heavy forensic endpoints by role; frontend hides forensic UI for non-admins. A plain integrity verdict stays visible to everyone. |
| Role model | **Second JWT claim value.** `app_metadata.role` ∈ {`dispatcher`, `admin_dispatcher`}, set by `service_role` at account creation. **No DB column, no Alembic migration.** |
| Role surfacing | Role is read from the validated token in `get_current_dispatcher` and attached to `UserRead`; `/auth/me` returns it; the frontend reads `user.role`. |
| Visible to normal dispatcher | **Only** the plain integrity verdict ("Records intact" / "⚠ altered — escalate"). No hashes, no Hedera refs. |
| Toggle | Admin-dispatcher gets a **"Forensic mode" switch, default OFF, per-session** (resets on reload). Normal dispatchers never see the switch. |
| Demo | **Real Supabase, two seeded accounts** (`DEMO_MODE=False`): one `dispatcher`, one `admin_dispatcher`. Log in as each to show the contrast. |
| Deferred | **Detail-endpoint `receipts[]` gating** (`GET /drivers/{id}`, `/vehicles/{id}`, trip detail returning empty `receipts` for non-admins) is **out of scope for FP-115** — tracked for a follow-up. |

## 3. Why this works with the current Supabase setup (no schema change)

Role authority lives in **Supabase Auth's `app_metadata`** (`auth.users.raw_app_meta_data`),
automatically embedded in every access token Supabase mints. The codebase already uses this exact
pattern for drivers — `backend/app/integrations/supabase_admin.py:37` sets
`"app_metadata": {"role": "driver"}` — and `auth/dependencies.py` already reads `app_metadata.role`
to gate. The public `users` table (the `User` model with org/email/name) is **not** touched; role
does not live there. `UserRead.role` is populated from the decoded token at request time.

**Setting the role:** for the two dispatcher accounts, set `app_metadata.role` to `"dispatcher"`
and `"admin_dispatcher"` via the Supabase dashboard (Authentication → Users → App Metadata), or via
the admin API.

**Two gotchas (documented so they don't bite):**
1. `app_metadata` only enters a token when that token is minted — change the role on a logged-in
   user and they must re-login/refresh before it takes effect. Seeded-up-front demo accounts avoid this.
2. The driver flow sets `role: "driver"`; the widened gate must accept `dispatcher` and
   `admin_dispatcher` but **still reject `driver`/`client_viewer`** — the `DispatcherRole` enum check
   guarantees this, so drivers keep getting 403 at dispatcher endpoints.

## 4. Design

### 4.1 Role model & backend auth
- New enum `DispatcherRole(str, Enum)` in `app/db/models/enums.py`: `DISPATCHER = "dispatcher"`,
  `ADMIN_DISPATCHER = "admin_dispatcher"`. (Enum only — no table.)
- `_require_dispatcher_role(payload)` widened: accept both values; **reject everything else**
  (drivers, client viewers). Return the resolved `DispatcherRole`.
- `get_current_dispatcher` populates `UserRead.role` from the token (real mode) and sets the
  `_DEMO_USER` stub to `DispatcherRole.DISPATCHER` (demo mode keeps working).
- New dependency `require_admin_dispatcher` — depends on `get_current_dispatcher`, raises **403** if
  `current_user.role != ADMIN_DISPATCHER`, else returns the user. Used to gate forensic endpoints.

### 4.2 Backend endpoint gating (hybrid)
| Endpoint | Change |
|---|---|
| `GET /blockchain/receipts` | Swap dependency to `require_admin_dispatcher` → 403 for normal dispatchers. Pure forensic. |
| `POST /blockchain/verify` | Stays open to all dispatchers, but **shape the response by role**: non-admin → `status` only, `receipt`/`expected_hash`/`current_hash` = `None`; admin → full payload. |

This is the "data is not one DevTools tab away" guarantee — real access control, not CSS.

### 4.3 Frontend role propagation + forensic toggle
- `DispatcherUser` (`lib/types/user.ts`) gains `role: 'dispatcher' | 'admin_dispatcher'`.
  `AuthContext` already fetches `/auth/me`, so `user.role` flows through with no new request.
- New `ForensicModeProvider` (`lib/context/ForensicModeContext.tsx`), mirroring `ToastContext`,
  exposing `{ canViewForensics, forensicOn, toggle }`:
  - `canViewForensics = user?.role === 'admin_dispatcher'`
  - `forensicOn` — per-session `useState`, default `false`.
  - `toggle()` — no-op when `!canViewForensics`.
  - Mounted in `app/layout.tsx`, **nested inside `AuthProvider`** (needs `user.role`).
- Guard component `ForensicOnly` (`components/blockchain/ForensicOnly.tsx`): renders children only
  when `canViewForensics && forensicOn`. Call sites wrap forensic UI; the blockchain components stay dumb.
- "Forensic mode" switch in `DispatcherShell`'s top bar (TopBar right slot), rendered **only** when
  `canViewForensics`.

### 4.4 Visibility matrix
| Surface | Normal | Admin (OFF) | Admin (ON) |
|---|---|---|---|
| Plain integrity verdict | ✅ | ✅ | ✅ |
| `BlockchainBadge` (Hedera seq + HashScan link) | ❌ | ❌ | ✅ |
| Mismatch Report modal (raw hashes) | ❌ | ❌ | ✅ |
| `EventTimeline` Hedera badges + `changed_fields` JSON | ❌ | ❌ | ✅ |
| `BlockchainReceipt` / `EvidencePacket` views | ❌ | ❌ | ✅ |

`VerifyButton`: the verified/mismatch **verdict always renders**; the "View Mismatch Report" button
and hash modal wrap in `ForensicOnly`. Backend already nulls the hashes for non-admins → defence in depth.

### 4.5 Out of scope
No new DB table/migration. No change to driver/guard/receiver auth (they have none — per CLAUDE.md).
No detail-endpoint `receipts[]` gating (deferred). No `create_dispatcher_auth_user` helper unless we
decide to seed in code (optional task below).

---

## 5. Implementation tasks

### Phase 1 — Backend (role model + gating)

1. **`app/db/models/enums.py`** — add `DispatcherRole(str, Enum)` with `DISPATCHER` and `ADMIN_DISPATCHER`.
2. **`app/schemas/people.py`** — add `role: DispatcherRole = DispatcherRole.DISPATCHER` to `UserRead`
   (default keeps backward compat for any endpoint serialising a `User` ORM row through `UserRead`).
3. **`app/auth/dependencies.py`**
   - Import `DispatcherRole`.
   - Rewrite `_require_dispatcher_role` to accept `{DISPATCHER, ADMIN_DISPATCHER}`, reject all else,
     and return the resolved `DispatcherRole`.
   - In `get_current_dispatcher`, capture the role from the token and set it on the returned
     `UserRead`; set `_DEMO_USER.role = DispatcherRole.DISPATCHER`.
   - Add `require_admin_dispatcher(current_user = Depends(get_current_dispatcher))` → 403 unless
     `current_user.role == ADMIN_DISPATCHER`.
4. **`app/api/v1/endpoints/blockchain.py`**
   - `GET /receipts`: replace `get_current_dispatcher` with `require_admin_dispatcher`.
   - `POST /verify`: keep `get_current_dispatcher`; when `current_user.role != ADMIN_DISPATCHER`,
     return `VerifyResponse(status=outcome.status, receipt=None, expected_hash=None, current_hash=None)`.
5. **`app/auth/router.py`** — `/auth/me` already returns the dispatcher; confirm `role` serialises
   (it will, since `get_current_dispatcher` now sets it). Update the `current_user` annotation to
   `UserRead` for accuracy.

### Phase 2 — Frontend (role + toggle + gating)

6. **`lib/types/user.ts`** — add `role: 'dispatcher' | 'admin_dispatcher'` to `DispatcherUser`.
7. **`lib/context/ForensicModeContext.tsx`** (new) — `ForensicModeProvider` + `useForensicMode()`
   hook exposing `{ canViewForensics, forensicOn, toggle }` as designed in §4.3.
8. **`app/layout.tsx`** — mount `ForensicModeProvider` inside `AuthProvider` (and around `ToastProvider`/children).
9. **`components/blockchain/ForensicOnly.tsx`** (new) — guard component rendering children only when
   `canViewForensics && forensicOn`.
10. **`components/layout/DispatcherShell.tsx`** — render a "Forensic mode" toggle in the TopBar right
    slot, shown only when `canViewForensics`, wired to `toggle()` / `forensicOn`.
11. **`components/blockchain/VerifyButton.tsx`** — keep the verdict always-visible; wrap the
    "View Mismatch Report" button + `MismatchReport` modal in `ForensicOnly`.
12. **Wrap remaining forensic surfaces in `ForensicOnly`** at their call sites: `BlockchainBadge`
    (incl. its use inside `EventTimeline`), `EventTimeline`'s `changed_fields` `<pre>` block,
    `BlockchainReceipt`, `EvidencePacket`. (Components unchanged; only their usages are guarded.)

### Phase 3 — Demo seeding (non-code)

13. In Supabase, set `app_metadata.role` on two dispatcher accounts: `"dispatcher"` and
    `"admin_dispatcher"`. Document the two accounts in the demo runbook (not in code, not in `.env`).
14. *(Optional)* If code-based seeding is preferred over the dashboard, add
    `create_dispatcher_auth_user(...)` to `app/integrations/supabase_admin.py` mirroring
    `create_driver_auth_user`, passing the chosen role in `app_metadata`. Flag as a shared-file change.

### Tests (write alongside the code they cover)

- **Unit** (`backend/tests/unit/test_auth_dependencies.py` or sibling):
  - `_require_dispatcher_role` accepts `dispatcher` and `admin_dispatcher`; rejects `driver`,
    `client_viewer`, and missing role.
  - `require_admin_dispatcher` raises 403 for a `dispatcher`, passes an `admin_dispatcher`.
- **Integration** (`backend/tests/integration/test_blockchain.py`):
  - `GET /blockchain/receipts` → 200 for admin, 403 for normal dispatcher.
  - `POST /blockchain/verify` → admin gets `expected_hash`/`current_hash`/`receipt`; normal
    dispatcher gets the same `status` with those three fields `None`.
  - Build both an `admin_dispatcher` and a `dispatcher` auth context in fixtures.
- **Frontend**: `ForensicOnly` renders/withholds correctly across the three states
  (normal; admin-off; admin-on); toggle is hidden for normal dispatchers.

---

## 6. Final verification (run once, at the end)

```
cd backend && pytest
cd frontend/dispatcher && npm run lint && npx tsc --noEmit
```

Manual smoke (real Supabase, `DEMO_MODE=False`): log in as the normal account → no Hedera/hash UI,
no Forensic switch, integrity verdict still shows. Log in as the admin account → Forensic switch
present, OFF by default; toggle ON → badges, mismatch report, receipts, changed-fields JSON appear.
Confirm `GET /blockchain/receipts` returns 403 for the normal account's token.

## 7. Shared files touched (flag in TASK COMPLETE / PR)

`backend/app/db/models/enums.py`, `backend/app/schemas/people.py`,
`backend/app/auth/dependencies.py`, `backend/app/auth/router.py`,
`backend/app/api/v1/endpoints/blockchain.py`, `frontend/dispatcher/app/layout.tsx`,
`frontend/dispatcher/lib/types/user.ts`. No migration. No `.env` keys. `config.py` untouched.

## 8. Suggested commits (you run git; not me)

- `feat(auth): add admin-dispatcher role and require_admin_dispatcher dependency`
- `feat(blockchain): gate receipts endpoint and shape verify response by role`
- `feat(dispatcher): forensic-mode provider, toggle, and ForensicOnly gating`
- `test(auth,blockchain): role gating unit + integration tests`
