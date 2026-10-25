# Fly compute region: recorded exception to the `af-south-1` assumption

**Status:** DECIDED, infra already matches (2026-10-25). No code change. **Owner:** Tim.

## What CLAUDE.md and the docs claim

`CLAUDE.md`'s POPIA section states: *"Personal data (identities, GPS, photos, parcel details) stays in
PostgreSQL in `af-south-1`."* `backend/fly.toml` previously pinned `primary_region = "jnb"` (Johannesburg)
on that basis — compute co-located with an in-country database. The same `af-south-1` claim is repeated in
~25 other docs (`docs/db-models.md`, `docs/deployment-runbook.md`, several design-notes, the Iteration 3
write-up, etc.).

## What's actually true

The Supabase project is **`eu-north-1` (Stockholm)**, not `af-south-1`. This was already measured and
recorded in `docs/reviews/codebase-audit/2026-10-22-ui-review-fix-plan.md:390` (~185ms round trip from Cape
Town). It was never corrected in `CLAUDE.md` or `fly.toml`.

## Decision (Tim, 2026-10-25)

Accept Stockholm as the real residency and **co-locate compute with the real DB region** rather than
pretend the DB is somewhere it isn't. `backend/fly.toml`'s `primary_region` is now `arn` (Stockholm) — this
matches where the 4 live machines were already running; only the comment and declared region were stale.
This is a recorded exception to the `af-south-1` line, not a silent contradiction of it.

## Why this is still defensible (exam line)

Personal data (driver identities, GPS, photos) is resident in the EU (Supabase, `eu-north-1`), not South
Africa. Only SHA-256 hashes ever reach Hedera — that boundary is unaffected by region. POPIA (section 72)
permits a cross-border transfer where an adequate level of protection applies; whether Supabase's data
processing terms meet that bar for this specific project is **not yet verified** — unlike the Gemini
exception in `docs/design-notes/2026-10-21-dispatcher-assistant-spec.md` (D1), which has a reviewed
paid-tier agreement cited as its basis. Say in an exam: *"PII resides in Supabase's `eu-north-1` region;
only hashes reach Hedera. The team is treating this as an accepted interim exception pending a documented
cross-border transfer basis — it was not a designed security boundary."* Do not claim POPIA compliance from
this note alone.

## Open follow-ups

1. **Correct `CLAUDE.md`'s POPIA line.** It currently states `af-south-1` as fact. Needs a PR on `dev`
   reviewed by all four team members per `CLAUDE.md`'s own footer — not done as part of this note.
2. **Get an actual POPIA basis for the transfer** (Supabase's DPA/sub-processor terms), or migrate the
   project to `af-south-1` if one isn't available — raise at standup.
3. The other ~24 docs repeating `af-south-1` are stale but lower priority; fix opportunistically, not as a
   dedicated pass.
