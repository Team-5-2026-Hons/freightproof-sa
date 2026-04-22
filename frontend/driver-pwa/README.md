# driver-pwa

Mobile Progressive Web App used by drivers at origin and destination gates to complete handshake steps — scanning seals, capturing photos, and submitting signatures.

**Stack:** Next.js 15 + next-pwa, TypeScript, Tailwind CSS.

**Auth:** JWT (same issuer as dispatcher backend). Drivers authenticate once per shift via OTP SMS.

**Scaffolding sprint:** This directory will be scaffolded in Sprint 2 once the core handshake API (FP-003/FP-005) is stable. Do not run `npx create-next-app` here until that sprint begins.
