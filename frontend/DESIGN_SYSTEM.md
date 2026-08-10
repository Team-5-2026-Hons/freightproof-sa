# FreightProof frontend design system

**Status:** current implementation guide
**Updated:** 2026-08-10

FreightProof presents operational evidence with calm, high-contrast interfaces. Status, exceptions, and anchoring state must be legible without relying on colour alone.

## Sources

The applications are the executable design-system source:

- Dispatcher tokens and global styles: `frontend/dispatcher/app/globals.css`
- Dispatcher components: `frontend/dispatcher/components/`
- Driver tokens and global styles: `frontend/driver-pwa/app/globals.css`
- Driver reusable UI: `frontend/driver-pwa/components/ui/`
- Driver phase components: `frontend/driver-pwa/components/phase/`
- Shared phase labels and recipes: `frontend/shared/lib/constants/phase-meta.ts`
- Shared status metadata: `frontend/shared/lib/constants/status-meta.ts`

Do not copy token values into this document. Update the CSS variables and component tests when the visual system changes.

## Principles

1. **Evidence first.** Make the captured fact, timestamp, actor, and receipt state easier to find than decorative content.
2. **One primary action.** Driver screens should offer one obvious next action with large touch targets.
3. **Honest system state.** Distinguish saved, queued, hashing, anchoring, anchored, failed, overridden, and exception states. Never display an anchored state without a receipt.
4. **Plan-driven progress.** Render the phase plan returned by the backend. Do not assume seven rows or one occurrence of each phase type.
5. **Accessible status.** Pair colour with an icon and text label. Maintain keyboard focus, screen-reader labels, and sufficient contrast.
6. **Responsive evidence.** Dispatcher tables may become cards on smaller screens; identifiers and exception context must remain visible.

## Current vocabulary

- **Phase** — one row in the committed trip plan.
- **Phase event** — the persisted plan/evidence row addressed by `phase_event_id`.
- **Handover** — an ordinary logistics-domain transfer of custody.
- **Exception** — a recorded discrepancy or operational finding.
- **Anchor status** — whether a phase's evidence hash is pending, anchored, or failed.

Do not introduce numbered fixed-step terminology into current UI copy, component names, routes, tests, or documentation.

## Driver patterns

- Use `StepHeader` for phase step identity and progress.
- Use `SwipeToConfirm` for deliberate evidence submission.
- Use `CameraCapture` and artifact-upload hooks rather than raw file inputs in pages.
- Preserve drafts by phase-event identity and keep captured evidence when navigation or connectivity fails.
- Keep the panic action reachable during an active trip.
- Do not show drivers expected cargo counts before their independent observation is committed.
- Do not expose dispatcher-only manifest contents to the driver.

## Dispatcher patterns

- Use shared status metadata for labels and colours.
- Keep trip reference, route, driver, current phase, exception count, and anchoring state scannable.
- Show exception and override explanations in context with the relevant phase row.
- Treat live SSE updates as a convenience; every screen must recover the authoritative state through a normal refetch.

## Evidence and blockchain display

- A hash without a receipt is **anchoring**, not anchored.
- `trip_creation`, `departure`, and `confirmation` are the currently anchored phase types.
- Other phases must not display a pending blockchain pipeline merely because they are incomplete.
- Truncated hashes must retain the complete value in an accessible label, title, copy action, or detail view.
- Personal data and evidence artifacts are not blockchain content; only canonical hashes and receipt identifiers are shown as on-chain proof.

## Change checklist

- Update the smallest shared component or token source that owns the pattern.
- Check both light and dark themes where supported.
- Verify mobile touch targets and keyboard navigation.
- Add or update component tests for state-dependent copy and behaviour.
- Run lint, type-check, and tests for the affected application.
- Update this guide only when principles, ownership, or reusable patterns change.
