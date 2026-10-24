# Client portal cleanup audit

**Reviewed:** 22 October 2026. **Branch:** `dev`. **Scope:** `frontend/client-portal/`, which has 29 non-test source files (about 2,340 lines, including `lib/types.ts`) and 10 test files. Companion to `2026-10-22-driver-pwa-cleanup-audit.md`, using the same method and category key.

**Outcome:** the cleanest of the three frontends reviewed. The comments are sparse and nearly all state a *why*. The cleanup is mostly repeated styling values (magic numbers), a few small duplications, and one outdated word in text that insurers see. No application code was changed during this audit.

---

## 1. How this was produced

| Check | Command (from `frontend/client-portal/`) | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit` | Clean |
| Unused locals and parameters | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | None in the portal. 5 in `frontend/shared/lib/types/phase.ts`, already listed in the driver-pwa audit (§3) |
| Lint | `npx eslint .` | Clean |
| Unused files and exports | `npx knip@5` | No unused files. `exceptionLabel`, `T0` and 4 types are only used inside their own files (§3) |
| Tests | `npx vitest run` | 57 / 57 pass |
| Comment and code review | Every source file read in full | §2 to §4 |

Category key: `HIST` changelog or history, `REF` ticket reference, `WHAT` restates the code, `ESSAY` over-explanation, `STALE` points at something that no longer exists, `DEAD` unused code.

---

## 2. Found during the review: not cleanup, needs an owner

| # | File | Finding | Suggested action |
|---|---|---|---|
| B1 | `components/Sections.tsx:277` | **Insurers see the outdated term.** The Location coverage note reads "the vehicle tracker is queried at **handshakes** and checkpoints". The handshake model was replaced by phases, and this sentence is shown to insurers and loss adjusters. | Reword to "queried at each trip phase and at checkpoints". Check that the PDF version (backend) uses the same wording. |
| B2 | `components/Sections.tsx:286-289` | `Integrity.copy()` awaits `navigator.clipboard.writeText` with no `try`. The call is rejected on non-HTTPS origins, when permission is denied, and in some in-app browsers. The rejection goes unhandled, and the button gives no feedback. | Catch the error, log it, and show "Copy failed: select the payload text instead". |
| B3 | `lib/api.ts:9` | `BASE_URL` falls back to `'http://localhost:8000'`. CLAUDE.md says no hard-coded URLs. A production build with the env var missing would silently point outsiders at localhost. | Fail at build time when `NEXT_PUBLIC_API_URL` is unset. |
| B4 | `components/Sections.tsx:64` | `onSelect(incident.exception_ids[0])` passes `undefined` if `exception_ids` is ever empty. The backend probably guarantees at least one, but the type does not say so. | Guard the call, or type the field as a non-empty tuple. Low priority. |

---

## 3. Dead and duplicated code

| Location | Finding | Action |
|---|---|---|
| `components/Sections.tsx:222` with `lib/timeline.ts:31-33` | The exceptions list builds the label `E{i + 1} · {humanise(type)}` inline, while `exceptionLabel()` in `lib/timeline.ts` builds the same string. That is why knip reports `exceptionLabel` as unused outside its own file. If one changes, the timeline and the list will label the same exception differently. | Use `exceptionLabel(i, e)` in `Sections.tsx` |
| `components/VerificationPanel.tsx:67-68` | `const results = Object.values(checks)` followed by `const done = results`: a pointless alias | Delete `results` and use `done` (or the reverse) |
| `components/VerificationPanel.tsx:6-7` | Two import lines from `@/lib/verify`, one for the type and one for the value | Merge them: `import { type AnchorCheckResult, verifyAnchoredRecord } from '@/lib/verify'` |
| `lib/api.ts:86` | `const encode = encodeURIComponent`: an alias that saves 10 characters and hides a standard API | Optional: use `encodeURIComponent` directly |
| `test/factories.ts:11` | `T0` is exported but only used inside the file | Drop `export` |
| `lib/types.ts` | `ObservationLevel`, `DriverSubstitutionRecord`, `ParcelRecord` and `StationaryPeriod` are exported but only used inside the file | Keep them: the file mirrors `backend/app/schemas/audit_pack.py` one to one. No action. |

---

## 4. Style and magic values

CLAUDE.md asks for "no magic numbers/strings". This app hard-codes pixel sizes and colours where the other apps use design tokens:

| Pattern | Count | Action |
|---|---|---|
| Arbitrary font sizes: `text-[10px]`, `[11px]`, `[12px]`, `[13px]`, `[15px]`, `[22px]` | 78 uses | Add a `fontSize` scale to `tailwind.config.ts` (for example `caption: 11px`, `meta: 12px`, `body: 13px`, `title: 15px`, `display: 22px`) and replace the arbitrary values |
| The small-caps label class string `text-[10px] / text-[11px] font-bold uppercase tracking-[0.1em] text-muted` | 11 copies in `Sections.tsx`, `PackViewer.tsx`, `SealCheck.tsx`, `EmailCodeGate.tsx` and `app/page.tsx` | Extract an `Eyebrow` / `SubHeading` component |
| Raw hex in components: `bg-[#e7fbf2]` (`VerificationPanel.tsx:81`), `bg-[#fffbea]` (`Sections.tsx:276`) | 2 | Add `ok.soft` / `warn.soft` tokens to `tailwind.config.ts`. The driver app and dispatcher enforce this with a `no-restricted-syntax` lint rule; consider adding the same rule here. |
| `RouteMap.tsx:18` `COLOUR` map of raw hex | 1 | Leaflet needs literal colour strings, so this is acceptable. `#7a4fb5` (tracker) is the only value missing from `tailwind.config.ts`. Optional: import all of them from one shared constants object. |
| `RouteMap.tsx` numbers: marker radii `4/6/8`, `maxZoom: 18`, `padding: [24, 24]`, `duration: 0.6` | 4 | Optional: name them as constants next to `FOCUS_ZOOM` |
| Helper functions with no return type: `copy` (`Sections.tsx:286`), `onFile` (`PdfCheck.tsx:25`), `select` (`PackViewer.tsx:84`), `rerunBrowserChecks` and `runServer` (`VerificationPanel.tsx:62, 72`), `verifyBytes` (`EvidencePhoto.tsx:43`) | 6 | Add `: void` / `: Promise<void>` (CLAUDE.md: "Type every signature") |
| Errors handled without logging: `EvidencePhoto.tsx:36`, `VerificationPanel.tsx:76`, `SealCheck.tsx:32` | 3 | They are not swallowed, because each one sets a visible failure state. CLAUDE.md does ask for errors to be logged, though, so add `console.warn` as the receiver app does. |
| `SealCheck.tsx:26-33` | 1 | The effect has no `cancelled` flag, unlike every other fetch effect in the app. Add one for consistency. |

---

## 5. Comment cleanup

The app has very few comments, and almost all of them should stay. Only these need a change:

| File:lines | Cat | Finding | Action |
|---|---|---|---|
| `components/DownloadButton.tsx:14-15` | REF | "(FP-291)" | Remove the ref; the sentence stands on its own |
| `components/EmailCodeGate.tsx:6-9` | REF | "(FP-291)" | Remove the ref |
| `lib/api.ts:4` | REF | "(FP-291)" | Remove the ref |
| `lib/types.ts:168, 383` | REF | "(FP-290)", "(FP-291)" in section headings | Remove the refs. `manifest v2` and `Emailed one-time code` already name the sections. |
| `lib/types.ts:383` | WHAT | A `// ── Emailed one-time code ──` banner | Optional: keep it. It is the only divider in a 393-line file and helps navigation. |
| `eslint.config.mjs:3` | HIST | The eslint-config-next 16 flat-config note | Optional: delete |

**Keep, do not trim:** the `lib/verify.ts` header (why there is no canonicalisation in the browser), the `lib/format.ts` notes about matching the PDF exactly, the state comments on `AnchorCheckState`, the `RouteMap` gap and Referer notes, the `PackViewer` Leaflet-SSR note, and the `next.config.js` header comments. These are exactly the *why* comments CLAUDE.md asks for.

---

## 6. Suggested execution

| PR | Contents | Verify with |
|---|---|---|
| 1 | B1 (copy text, which insurers see) and B2 (clipboard error) | `npx vitest run`, plus a manual check of the Coverage card and the Copy button |
| 2 | §3 duplicates and §5 comment refs | `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` |
| 3 | §4 tokens: the `fontSize` scale, `Eyebrow`, the hex tokens and the optional lint rule | The same checks, plus a visual before-and-after of `/p/<token>` and `/v/<packId>`. The arbitrary px values must map to tokens of identical size, so nothing moves. |
| Separate | B3 (env handling), B4 | Owner |
