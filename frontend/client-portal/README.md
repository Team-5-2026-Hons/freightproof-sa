# client-portal

Read-only evidence portal for cargo owners and consignees to view trip status, handshake timeline, and downloadable PDF evidence reports.

**Stack:** Next.js 15, TypeScript, Tailwind CSS. Server Components only — no write operations, no mutations.

**Auth:** One-time OTP link emailed to the receiver at trip close. No persistent account.

**Scaffolding sprint:** This directory will be scaffolded in Sprint 3 once the evidence report generation (PDF export) feature is complete. Do not run `npx create-next-app` here until that sprint begins.
