# FreightProof documentation

This index distinguishes current implementation documentation from business context and historical design material. The running code, Alembic migrations, and generated OpenAPI contract take precedence when a historical document disagrees with the implementation.

## Start here

- [Repository README](../README.md) — implemented scope, setup, validation, deployment, and known limitations.
- [Phase model explained](phase-model-explained.md) — current plan-driven trip lifecycle. This document must use phase terminology and must not describe the retired fixed-step workflow as current behaviour.
- [Demo script](demo-script.md) — presentation flow and honest limitations.
- [Scope boundaries](scope-boundaries.md) — what the project does and does not claim.
- [Glossary](glossary.md) — agreed domain and implementation vocabulary.
- [Known issues](known-issues.md) — unresolved environment and implementation risks.

## API contract

The current HTTP contract is generated from the FastAPI application:

- Local Swagger UI: `http://localhost:8000/docs`
- Local OpenAPI JSON: `http://localhost:8000/openapi.json`
- Route implementations: [`backend/app/api/v1/endpoints`](../backend/app/api/v1/endpoints/)
- Request and response schemas: [`backend/app/schemas`](../backend/app/schemas/)

The handwritten dispatcher/driver API contract under `backend/docs` predates the phase model. It is historical material, not an implementation source.

## Supporting domain and integration documents

- [Parcel traceability](parcel-traceability.md)
- [Frontend design system](../frontend/DESIGN_SYSTEM.md)

The dated [Parcel Perfect investigation](parcel-perfect-integration-spec.md) and
[dispatcher handoff](dispatcher-handoff-2026-08-06.md) record decisions and follow-up work from a
point in time; they are not current contracts.

Meeting minutes, vendor reference files, mock-ups, diagrams, and research notes support the project history. Archived research and partner-provided material must be reviewed for permission, confidentiality, and POPIA/IP considerations before the repository is made public or included as a submission artifact.

## Historical material

Older plans, walkthroughs, meeting records, mock-ups, and pre-phase-model specifications remain in
their existing repository locations. Their placement is unchanged in this focused cleanup so that a
large history-only file move does not obscure the current documentation corrections.

These files may refer to the retired fixed-step model, deleted endpoints, old status enums, earlier
test counts, or planned integrations as though they were current. Do not cite them as the source of
truth for code changes. Archive, remove, or exclude them from the submission in a separate,
history-only change after confirming the project's record-retention requirements.

## Maintenance rules

1. Update the repository README and the relevant current document in the same pull request as a behaviour change.
2. Link to a single definition instead of copying configuration or lifecycle tables between documents.
3. Archive or remove superseded material in a dedicated history-only change.
4. Use `phase`, `phase event`, and `handover` for current behaviour.
5. Verify local links and commands before merging documentation changes.
