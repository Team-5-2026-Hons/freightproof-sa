# Documentation archive index

Archived documents are retained for provenance, academic evidence, and decision history.
They are not current implementation authority. Search this index by original filename,
topic, or ticket ID before relying on an archived record.

## 2026-09-26 cleanup

### FreightProof Implementation Plan v2

- **Topic / ticket ID:** historical implementation plan; Ticket ID: none.
- **Description:** Original sprint plan, epic definitions, acceptance criteria, and technical sequencing.
- **Original path:** `docs/FreightProof Implementation Plan v2.docx`
- **Archived path:** [root/FreightProof Implementation Plan v2.docx](root/FreightProof%20Implementation%20Plan%20v2.docx)
- **Archive date / reason:** 2026-09-26 — superseded iteration plan; removed from the default build-authority path.
- **Replacement:** no direct replacement.
- **Outstanding work:** no work was transferred by this archival; current planning remains in active plans and the issue tracker.
- **Format status:** Word binary preserved without rewriting.

### FreightProof Full Picture v4

- **Topic / ticket ID:** historical system scope and domain walkthrough; Ticket ID: none.
- **Description:** Earlier full-picture description of system scope, integrations, and stakeholder requirements.
- **Original path:** `docs/FreightProof_Full_Picture_v4.docx`
- **Archived path:** [root/FreightProof_Full_Picture_v4.docx](root/FreightProof_Full_Picture_v4.docx)
- **Archive date / reason:** 2026-09-26 — clearly superseded by later full-picture references.
- **Replacement:** [FreightProof Full Picture v7](../FreightProof_Full_Picture_v7.md).
- **Outstanding work:** no work was transferred; reconcile v7 with current source in the separate current-document reconciliation task.
- **Format status:** Word binary preserved without rewriting.

### FreightProof Full Picture v6

- **Topic / ticket ID:** historical system scope, integrations, and five-handshake model; Ticket ID: none.
- **Description:** v6 domain walkthrough, including the v5-to-v6 change record.
- **Original path:** `docs/FreightProof_Full_Picture_v6.md`
- **Archived path:** [root/FreightProof_Full_Picture_v6.md](root/FreightProof_Full_Picture_v6.md)
- **Archive date / reason:** 2026-09-26 — explicitly superseded by v7 and the phase model.
- **Replacement:** [FreightProof Full Picture v7](../FreightProof_Full_Picture_v7.md).
- **Outstanding work:** no work was transferred; active lifecycle work is tracked in the [phase model reference](../phase-model-explained.md) and active plans.

### FreightProof Frontend Spec v1

- **Topic / ticket ID:** historical Dispatcher Portal and Driver PWA frontend specification; Ticket ID: none.
- **Description:** Pre-backend UI/UX build manual based on the former five-handshake model and typed local fixtures.
- **Original path:** `docs/FreightProof_Frontend_Spec_v1.md`
- **Archived path:** [root/FreightProof_Frontend_Spec_v1.md](root/FreightProof_Frontend_Spec_v1.md)
- **Archive date / reason:** 2026-09-26 — superseded historical frontend specification; it declares that no backend exists and relies on the retired lifecycle model.
- **Replacement:** no direct replacement.
- **Outstanding work:** no work was transferred; unresolved frontend decisions remain in active plans, current source, and team review rather than this retired spec.

### Step-Event Ledger — Correction Decision Record

- **Topic / ticket ID:** phase-event ledger correction decisions; Ticket ID: none (references FP-149 as protected backlog).
- **Description:** Audit trail for corrections incorporated into the Step-Event Ledger implementation plan.
- **Original path:** `docs/design-notes/2026-09-05-step-event-ledger-plan-corrections.md`
- **Archived path:** [design-notes/2026-09-05-step-event-ledger-plan-corrections.md](design-notes/2026-09-05-step-event-ledger-plan-corrections.md)
- **Archive date / reason:** 2026-09-26 — explicitly incorporated and superseded by its authoritative implementation plan.
- **Replacement:** [Step-Event Ledger implementation plan](../design-notes/2026-09-02-step-event-ledger-implementation-plan.md).
- **Outstanding work:** D-8 and the implementation plan's other open decisions remain tracked in the replacement plan; FP-149 remains protected in that plan and current planning.

### Phase model explanation — pre-cleanup copy

- **Topic / ticket ID:** historical phase-model rationale and lifecycle explanation; Ticket ID: none.
- **Description:** Exact pre-cleanup copy of the detailed phase-model explanation, retained because the maintained reference was condensed.
- **Original path:** `HEAD:docs/phase-model-explained.md` before the 2026-09-26 cleanup.
- **Archived path:** [phase-model-explained-pre-cleanup.md](phase-model-explained-pre-cleanup.md)
- **Archive date / reason:** 2026-09-26 — preserve historical explanation without restoring it over the current reference.
- **Replacement:** [current phase-model reference](../phase-model-explained.md).
- **Outstanding work:** current lifecycle branch/deployment status remains tracked by active lifecycle documentation; this archived record has no active work.

## Graphify maintainer handoff — PENDING

The developer designated to merge this cleanup to `dev` should exclude `docs/archive/**`
from Graphify's retrieval corpus (while retaining this index if it remains useful for
navigation), then rebuild Graphify from the merged `dev` state. This pass did not change
Graphify output or configuration; its existing snapshot can still surface archived plans
until that maintainer action is completed. **This exclusion is not implemented yet.**
