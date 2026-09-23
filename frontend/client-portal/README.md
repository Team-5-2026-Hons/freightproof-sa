# client-portal

The page an outsider opens from an **audit-pack share link** — an insurer, loss adjuster,
client or SAPS detective. No account: the unguessable token in the URL is the credential,
every use of it is logged, and the issuing dispatcher can revoke it.

| Route | What it shows |
|---|---|
| `/p/<token>` | The full pack: verification banner, observations, incident summary, timeline synced to a map, evidence photos, cargo, exceptions, parties, coverage, integrity appendix, PDF copy check |
| `/v/<pack id>` | The seal check printed on every PDF — proves a copy is genuine without showing any evidence |

**Verification runs in the visitor's browser.** For each anchored record the page hashes
the exact canonical string the server hashed (Web Crypto) and compares it with the message
the public Hedera mirror node holds. FreightProof's servers are not involved, so the check
does not ask the reader to trust us. An unreachable mirror is shown as *unavailable*, never
as a mismatch.

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 3.4, Leaflet. Read-only:
no mutations. Types in `lib/types.ts` mirror `backend/app/schemas/audit_pack.py`.

```bash
nvm use 22                                   # vitest 3 / vite 7 need Node ≥ 20.19
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev   # http://localhost:3003
npm test && npm run type-check && npm run lint
```

`test/fixtures/verify-vectors.json` holds canonical strings and hashes produced by the
backend's own `canonicalize_payload` / `compute_payload_hash`. If the canonical form ever
changes, regenerate them — the browser check is only as good as those vectors.

Design, research and decisions: `docs/design-notes/2026-09-23-insurer-audit-trail-plan.md`.
