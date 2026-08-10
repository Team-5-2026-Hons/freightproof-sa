# Coordination note — Driver app (linehaul) design input for Tim

> **Status:** design input / coordination. **`driver-pwa/` is Tim's branch — this note does not
> change code.** The H2 "Manifest"→"Linehaul" rename is Tim's to action.
> **Author:** Ciaran · **Date:** 2026-06-24
> **Source:** Bruce meeting 24 Jun. **Builds on:** `docs/glossary.md`,
> `docs/scope-boundaries.md`, `docs/design-notes/2026-06-24-multi-stop-handshakes.md`.
> **Iter-2 scope:** single-origin/single-destination, 5 handshakes (multi-stop deferred).

---

## 1. What the 24 Jun meeting changes (the deltas)

1. **"Manifest" → "Linehaul" (the big one).** The driver must **never** see contents or per-parcel
   data — theft risk, Bruce's hard line. The current H2 framing (`ppManifestParcelCount`) is wrong
   twice over: it's a *linehaul*, not a manifest, and the count is **consolidated units**, not parcels.
2. **The driver's single document is the digital linehaul:** vehicle type / registration, driver
   details, **seal number(s)**, and a **consolidated unit count**. The system *generates* it.
3. **Seal is first-class.** Capturing/verifying the seal (photo + number) is the driver's key
   correctness action — not parcel scanning.

## 2. Design philosophy — "capture, don't decide"

The driver **records evidence**; the **system judges correctness** by cross-checking captured data
against the locked journey plan. The driver is never asked "is this right?" — that is what makes the
app both easy and reliable.

Five principles:

- **One screen, one action.** Cab / glare / gloves / time pressure → big buttons, no menus, no
  scrolling lists. Home = *today's trip + the current step*.
- **Guided linear flow driven by the locked plan.** The app only offers the *next valid handshake*
  (state machine enforces sequence) — the driver cannot skip or reorder steps. This is how
  correctness is guaranteed without relying on the driver's memory.
- **Minimal input, maximal capture.** GPS + timestamp auto-captured (zero taps). Seal via
  **scan / NFC** rather than typing (Bruce: door-NFC is a "no-brainer"). Counts confirmed by tap,
  photos by camera. Typing is the enemy.
- **Gate submission on required evidence.** "Submit" stays disabled until photo / seal / count is
  captured. Inline validation flags a seal or count mismatch immediately ("Seal doesn't match —
  re-check") and routes it to a dispatcher-visible exception instead of letting bad data through.
- **Offline-first.** Queue evidence locally, sync on reconnect (FP-70) — the N3 has dead zones; the
  app must never block waiting on signal. Anchoring/tamper-evidence is invisible to the driver; they
  just see "✓ logged."

## 3. Iter-2 flow (single-O/D)

A vertical timeline the driver walks top-to-bottom, each step a guided capture:

1. **Origin Gate-In** — tap "Log entry" → auto photo + GPS + timestamp.
2. **Loading Complete** — view **linehaul** (unit count, route, vehicle) → photograph + scan
   **seal** → confirm unit count → submit.
3. **Gate-Out** — seal verify photo → depart.
4. **In Transit** — mostly passive; one always-visible **panic button**; checkpoints / deviations
   handled by the system, not the driver.
5. **Destination Gate-In → Unload → POD** capture → trip closes.

## 4. Forward-compatibility (don't paint into a corner)

The single-O/D flow above is the **degenerate case** of the multi-stop, per-stop-handshake model in
`docs/design-notes/2026-06-24-multi-stop-handshakes.md`. Building it now does not block multi-stop
later — each stop will just repeat the gate-in / (unload) / (load) / seal / gate-out block. Keep the
per-step capture components generic enough to be reused per stop.

## 5. Action for Tim

- Rename H2 **"Manifest" → "Linehaul"**; show **unit count**, not parcel count; remove any
  per-parcel listing from the driver view.
- Treat the **linehaul** (units + seal + reg + driver) as the driver's single source document.
- Confirm the constraints above fit the current `driver-pwa/` shell; flag anything that conflicts.

> POPIA / `output: 'export'` reminder: every `driver-pwa/` page is `"use client"` (Capacitor APK).
> Nothing here changes that.
