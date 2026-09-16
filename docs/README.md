# FreightProof SA — Design Documents

These documents are authoritative. Any design question, scope dispute, or
architecture decision is resolved by consulting these documents first.

## Documents

- **FreightProof Implementation Plan v2.docx** — Sprint plan, epic definitions,
  acceptance criteria, and technical sequencing. Section 4 defines epics;
  Section 5 defines Sprint 1 requirements.

- **FreightProof Full Picture v4.docx** — Full system scope, integration
  context, domain model, and stakeholder requirements.

## Iteration 3 (current)

- **[iteration3_plan.md](iteration3_plan.md)** — Active plan. Sprint 6/7 scope,
  the Pulsit corroboration work, receiver-controlled handover, analytics read models
  and live alerting, the controls/validation block, cuts, and open decisions.
  Revised 2026-08-25 against the iteration 2 feedback.

- **Before Sprint 6** (artifact only) —
  https://claude.ai/code/artifact/9f14087e-a5a9-4cf2-a5d1-b3df7991cb91
  The fourteen decisions the team has to settle, each with a recommendation and a link
  into whichever document holds the reasoning. Start here.

- **[iteration2-feedback-response-2026-08-25.md](iteration2-feedback-response-2026-08-25.md)**
  — Point-by-point verification of both iteration 2 marksheets and the Q&A transcript
  against `dev`, with file:line evidence. Which critiques are real, which describe code
  that already exists, and the unanchored-evidence-artifact gap no reviewer found.

- **[scale-readiness-2026-08-18.md](scale-readiness-2026-08-18.md)** — Response to
  the iteration 2 code review. Which critiques were already solved (pub/sub outbox,
  rollback discipline) and the open concurrency bug on `parcel_perfect_reference`.

- **[design-notes/2026-08-24-corroboration-parcel-client-views.md](design-notes/2026-08-24-corroboration-parcel-client-views.md)**
  — UI/UX spec for the two-witness geofence display, the parcel timeline with its
  sealed band, per-client lens redaction rules, and the analytics the panel asked for.

> These four carry live iteration 3 decisions. Read them before touching
> `geofence_service`, `app/analytics/`, `PhaseLocationSection`, or the receiver flow.
> Rendered versions are linked in each file's front matter; the markdown here is
> authoritative and is what the knowledge graph indexes.

## Usage

When raising a pull request that touches scope, link to the relevant section
of the appropriate document. Do not make architectural decisions that contradict
these documents without a team discussion and an updated document version.
