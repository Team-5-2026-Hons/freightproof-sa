# Receiver app cleanup audit

**Reviewed:** 22 October 2026. **Branch:** `dev`. **Scope:** `frontend/receiver/`, which has 12 non-test source files (about 1,080 lines) and 4 test files. Companion to `2026-10-22-driver-pwa-cleanup-audit.md`, using the same method and category key.

**Outcome:** the app is small and mostly clean. Nearly all of its comments explain a real *why* (security, POPIA, anti-oracle), so keep them. There is one real bug, about five stale or AI-style comments, and two pieces of duplicated code. No application code was changed during this audit.

---

## 1. How this was produced

| Check | Command (from `frontend/receiver/`) | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | Clean |
| Unused locals and parameters | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | None in the receiver. 5 in `frontend/shared/lib/types/phase.ts`, already listed in the driver-pwa audit (§3) |
| Lint | `npx eslint .` | Clean |
| Unused files and exports | `npx knip@5` | No unused files. One export that is only used inside its own file (§3) |
| Tests | `npx vitest run` | 18 / 18 pass |
| Comment and code review | Every source file read in full | §2 to §4 |

Category key: `HIST` changelog or history, `REF` ticket reference, `WHAT` restates the code, `ESSAY` over-explanation, `STALE` points at something that no longer exists, `DEAD` unused code.

---

## 2. Found during the review: not cleanup, needs an owner

| # | File | Finding | Suggested action |
|---|---|---|---|
| B1 | `components/Swipe.tsx:39, 56-60`, with `app/h/[token]/HandoverPageClient.tsx:181-186` | **"Please try again" is a dead end.** `Swipe` sets `hasFiredRef.current = true` on the first confirm and never resets it. When the attestation canvas fails (`renderAttestation` returns `null`), the page shows "Please try again" and returns to `ready`. `Swipe` stays mounted, so every later swipe returns early from `fire()` and the receiver cannot confirm. Found by reading the code; not reproduced in a test. | Reset `hasFiredRef` when `disabled` goes from true to false, using the existing `prevDisabled` block at lines 108-112, or remount `Swipe` with a `key`. Add a test for "confirm fails, then swipe again". |
| B2 | `lib/api.ts:12` | `BASE_URL` falls back to `'http://localhost:8000'`. CLAUDE.md says no hard-coded URLs. On a phone, `localhost` is the phone itself, so a build with a missing env var fails with "This link is no longer valid" and gives no clue why (`.env.example` explains this at length). | Fail loudly at build time when `NEXT_PUBLIC_API_URL` is unset, instead of silently using localhost. |

---

## 3. Dead and duplicated code

| Location | Finding | Action |
|---|---|---|
| `app/mock-idvs/[sessionId]/page.tsx:14-38` with `app/h/[token]/HandoverPageClient.tsx:36-70` | `IDENTITY_STASH_KEY`, the `StashedIdentity` interface and the read-and-validate function are written twice. The two copies have already drifted: `token` is optional in one and required in the other, and only one checks `idNumber`. If the key changes in one file only, the mock vendor's return link breaks without any error. | Move them to `lib/identity-stash.ts` (`stashIdentity`, `readStashedIdentity`, `clearStashedIdentity`) and import from both pages |
| `app/h/[token]/HandoverPageClient.tsx:314-348` and `369-412` | The page header and the name and ID-number inputs, with the ID-shape hint, are repeated as about 35 identical lines of JSX on the consent screen and the ready screen | Extract an `IdentityFields` component (props: `name`, `idNumber`, `disabled`, setters) and a `DeliveryHeader` |
| `lib/api.ts:14` | `HandoverError` is exported, but nothing outside `api.ts` imports it. Callers catch `unknown` and log it. | Drop `export`, or use `err instanceof HandoverError` in the page to tell network failures from HTTP ones (log only; the generic anti-oracle message must stay) |
| `lib/api.ts:29, 38, 81` | `ConfirmPayload`, `HandoverConfirmed` and `VerifyStarted` are exported types that are only used inside `api.ts` | Fine as they are: they document the wire contract. No action. |

---

## 4. Comment cleanup

| File:lines | Cat | Finding | Action |
|---|---|---|---|
| `lib/api.ts:1` | WHAT | A comment that just repeats the file path | Delete |
| `lib/api.ts:3-6` | STALE, ESSAY | Says "talks to exactly two endpoints" and "this file is forty lines where the driver app's client is two hundred". It now calls **five** endpoints and is 158 lines long, and the size comparison adds nothing. | Trim to: "No session or bearer token: the capability token in the URL and an HttpOnly binding cookie together authorise every call." Keep lines 8-10 (`credentials: 'include'` is load-bearing). |
| `components/ConsentGate.tsx:1-2` | WHAT | A comment that just repeats the file path | Delete (keep the POPIA s26/s27 why at lines 3-9) |
| `components/Swipe.tsx:1-5` | ESSAY | "NOT a port of driver-pwa's SwipeToConfirm — that component's design-system tokens…" compares this file with another app | Trim to: "Slide-to-confirm: confirming spends a single-use token and writes an immutable row, so one accidental tap must never trigger it." |
| `components/Swipe.tsx:105-107` | ESSAY | Explains a standard React pattern and includes a docs URL | Trim to: "A disabled control must not stay parked at the end of its track." |
| `app/h/[token]/HandoverPageClient.tsx:107-108` | WHAT | Restates what `consentBusy` is for | Trim to: "Consent-record call in flight; ConsentGate stays on screen." |
| `app/h/[token]/HandoverPageClient.tsx:234-235` | REF, HIST | "No selfie step: one that was never stored proved nothing (FP-316)" describes a step that was removed | Trim to: "No document: confirm as typed-only." |
| `app/h/[token]/HandoverPageClient.tsx:260` | WHAT | "Shared by both the consent screen and the ready screen" | Delete (moot once `IdentityFields` is extracted, see §3) |
| `eslint.config.mjs:3` | HIST | Notes the eslint-config-next 16 flat-config shape | Optional: delete. The import line already shows it. |

**Keep, do not trim:** the anti-oracle header in `HandoverPageClient.tsx` (1-6), the sessionStorage rationale (31-35), the confirm-burns-token note (199-200), the comment on the server page about not fetching server-side, `layout.tsx` `robots`, `next.config.js` headers, `lib/consent.ts` (hash and version), and the `resolveVerification` body-not-URL note in `api.ts`. These are the kind of *why* comments CLAUDE.md asks for.

`.env.example` (26 lines for one key) is long but every paragraph prevents a real deployment failure. Leave it.

---

## 5. Suggested execution

| PR | Contents | Verify with |
|---|---|---|
| 1 | B1 fix and its test | `npx vitest run` |
| 2 | §3 (stash module, `IdentityFields`) and §4 comments | `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, then one manual walk through `/h/<token>` → mock IDVS → back |
| Separate | B2 (env handling) | Build with `NEXT_PUBLIC_API_URL` unset and check that it fails clearly |
