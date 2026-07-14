# guard

Plain HTML + JavaScript page used by warehouse guards to confirm a vehicle's arrival or departure at a gate. No framework, no build step, no login — guards have no accounts.

**Stack:** Vanilla HTML/CSS/JS only. No React, no Next.js, no bundler.

**Auth:** None. The page is reached via a one-time QR code or short URL tied to the active trip. The URL itself is the access control.

**Scaffolding sprint:** This directory will be scaffolded in Sprint 2 alongside the gate-in handshake endpoints. Do not add a framework here — the plain HTML constraint is intentional and documented in the Full Picture spec.
