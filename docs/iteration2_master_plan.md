# FreightProof SA — Iteration 2 Master Plan

> Single source of truth for iteration 2. Reconciles the iteration-2 kickoff brief
> ([iter2_kickoff_meeting.md](iter2_kickoff_meeting.md)) with the Bruce-prep team call (5 Jun)
> and the lecturer meeting with Aisha + Maya (8 Jun). Where they conflict, this document wins —
> it reflects the decisions the team actually landed on.
>
> **Due:** 7 Aug (document the Friday before) · **Presentation:** 10–11 Aug *(⚠ confirm exact date)*
> **Jira:** `FP` project on `inf4027team5.atlassian.net`

---

## 0. The frame

- **Goal (one sentence):** demo the **full five-handshake trip lifecycle end-to-end**, driven from the UI,
  with evidence anchored at every step.
- **Differentiator (Aisha's mandate — must be explicit in the demo):** this is **not** "we digitised the
  paper trail." It is **tamper-evident, blockchain-anchored legal/insurance evidence** — the journey-lock
  hash makes post-hoc trip tampering provable. Don't just automate a manual process; show the surprise element.
- **Demo approach:** a UI-driven simulation harness (dev-only button panel) **+ mock external data in JSON
  files shaped exactly like the real Parcel Perfect / Pulsit API**. Never create new DB models for mock data
  (it breaks the real integration later).
- **Scope spine:** *FreightProof is an evidence layer that records what happened — it does not run operations.*

---

## 1. Decisions locked (these supersede the written brief)

| Topic | Decision | Change vs brief |
|---|---|---|
| **Trip model (D1)** | Lean **Option B** — refactor data model to support multi-leg / multi-client; **demo stays single-client FedEx JHB→DBN**. **Pending Bruce (BQ3).** | Brief said Option C |
| **Cancellation (B6)** | **IN scope.** Records evidence only (closes the chain). API-driven preferred + **manual fallback button**. | Brief had it OUT |
| **Forensic view (D2)** | **Admin-dispatcher role** with forensics toggle; normal dispatchers see no blockchain detail. | Brief recommended a plain toggle |
| **Horse substitution (BQ1)** | **Swap event on the same trip**, not a new trip. | Confirmed |
| **Return leg (D4)** | **New one-direction trip.** Scheduling returns is out of scope. | Confirmed |
| **Trailer zones (B2)** | Out of scope (dry-freight beachhead). | Confirmed |
| **Document upload** | **IN iteration 2** (waybills are physical today). | Confirmed |
| **Parcel granularity (NEW — Maya, 8 Jun)** | **Investigate** per-parcel/envelope vs bulk tracking; may add a child item level under `Consignment`. | New |

---

## 2. The work, by phase (mapped to live Jira tickets)

Phases map to the vac timeline. Each phase ends with a working demo against trunk.

### Phase 1 — Foundations & data model (wk 1–2)
| Work | Ticket |
|---|---|
| Refactor `Trip` → `TripStop` / multi-leg model | **FP-112** (new) |
| Update journey-lock-hash payload to include stops | **FP-113** (new) |
| Dispatcher trip wizard — multi-stop UI | **FP-114** (new) |
| Forensic view + admin-dispatcher role | **FP-115** (new) |
| Trip cancellation — manual fallback + API-driven | **FP-117** (new) |
| Send Bruce + Parcel Perfect emails **day 1** | — |

### Phase 2 — Full handshake circle (wk 3–4)
| Stage | Tickets |
|---|---|
| Driver PWA shell | **FP-69** (+ FP-39, FP-58) |
| 1. Origin Gate-In | **FP-67** (+ FP-78, FP-79, FP-80, FP-81), **FP-68** |
| 2. Loading Complete | **FP-84** (Parcel Perfect manifest — mocked), **FP-72**, **FP-73**\*, **FP-85** |
| 3. In Transit | **FP-86**, **FP-88** (panic), **FP-70** (offline queue) |
| 4–5. Destination + Close | **FP-89**, **FP-90**, **FP-91**\*, **FP-74**\*, **FP-92** (final anchor) |
| Cross-cutting | **FP-83** (driver substitution — normal event) |
| Simulation harness `/dev/simulate/[tripId]` | **FP-116** (new) |

\* **FP-73 / FP-74 / FP-91 are blocked on Bruce (BQ2)** — physical-photo vs on-device signature.

### Phase 3 — Polish + integration prep (final week)
| Work | Ticket |
|---|---|
| Pulsit deviation polling (mocked) | **FP-87** |
| Merkle batching *(stretch)* | **FP-63** |
| Evidence-PDF export, SLA dashboard polish | *(under FP-8; create when scoped)* |
| Real Parcel Perfect sandbox wiring **if** dev contact comes through, else → iter 3 | **FP-121** feeds this |

### Documentation / research (run in parallel)
| Work | Ticket |
|---|---|
| `docs/scope-boundaries.md` defence document | **FP-119** (new) |
| NFC feasibility + cost analysis | **FP-120** (new) |
| Parcel Perfect API field-mapping spec (+ parcel-granularity question) | **FP-121** (new) |
| National Transport Act + driver contract review | **FP-122** (new) |

---

## 3. Ticket changes already applied (kickoff §11.2)

| Ticket | Change |
|---|---|
| **FP-81** | Summary + description rewritten: **Supabase Storage (af-south-1) only**, AWS S3 dropped (POPIA). *(assigned to Thomas)* |
| **FP-83** | Reclassified as a **normal 4-field event** (location, out/in driver IDs, timestamp + planned/unplanned), not an exception. |
| **FP-68** | Note added: route the demo path through the **simulation harness** (FP-116); keep real verification logic. |

### Still to do on the board (not yet done — needs team OK)
- **Re-status stale epics** FP-1 / FP-2 / FP-3 (and review FP-33): they show "To Do" despite delivered
  iteration-1 children. Flip to In Progress / Done so the board reflects reality at the demo. *Left undone
  pending confirmation it won't clash with anyone mid-merge.*
- **Create sprints** in the board UI (this can't be done via the API). Suggested: `Iter2-S1 Foundations`
  (wk1–2) · `Iter2-S2 Handshake circle` (wk3–4) · `Iter2-S3 Polish + integration`. Then assign tickets above.

---

## 4. Blocked — do NOT start (pending Bruce)

| Item | Blocked on |
|---|---|
| FP-73 / FP-74 / FP-91 — physical vs on-device signature | **BQ2** |
| Break-bulk multi-client extension (how far FP-112 goes) | **BQ3** |
| Horse-substitution working assumption (swap event) | **BQ1** confirm |
| Return-leg working assumption (new one-way trip) | **BQ5** confirm |

---

## 5. Non-code actions / investigations

- **Emails (day 1):** Bruce (clarifications BQ1–BQ5) + Parcel Perfect (`support@ParcelPerfect.com` for a
  sandbox / dev contact — pitch as a *custom solution for Bruce*, don't lead with blockchain).
- **Load Factor site visit** (JHB, during the holiday) — Aisha strongly endorsed seeing it firsthand.
- **Parcel-granularity investigation** (Maya) — feeds FP-121 and the `Consignment` model.
- **Build JSON mock data** matching Parcel Perfect's real API shape (feeds FP-116).
- **Weekly standups:** Wednesdays ~11:00 (skip Mozambique / St Francis weeks).

---

## 6. Definition of done for iteration 2

By the end of the vac the board should show:
- All handshake stories Done (FP-63 acceptable as carry-over).
- The 11 new tickets created (done) and the unblocked ones Done.
- `docs/scope-boundaries.md` written; foundation epics re-statused.
- A working **end-to-end demo of all five handshakes driven from the UI — no DB edits.**
- The differentiator stated explicitly in the demo and the iteration-2 document.
