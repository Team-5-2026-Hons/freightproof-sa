# FreightProof production environment and AI harness — proposed roadmap

**Date:** 6 October 2026. **Status:** proposal, not an approved sprint commitment.
**Evidence:** scoped inspection of branch `Ciaran`; no live infrastructure audit,
database connection, dependency scan, deployment or test-suite execution was performed.

## Handoff for a fresh session

FreightProof records cargo journeys and delivery evidence. Four developers currently
work on it; preserve the existing FastAPI, Supabase, Celery/Redis, Hedera, Next.js and
Capacitor architecture. The proposed first production milestone is a controlled partner
pilot, with named support and release owners, bounded usage, evidence preservation and
a proven recovery path. Establish a reproducible environment, a common task contract,
enforced release checks, end-to-end journey verification, and operational recovery.
Current CI already checks three frontends, backend code and fresh-database migrations.
Start with Stage 0: confirm the pilot boundary and owners, then approve and size each
work packet. This document supplies priorities and acceptance gates, not permission to
change every listed file. Read `CLAUDE.md` and applicable directory instructions before
execution. Existing proposals and historical findings do not become requirements here.

## Approach and alternatives

**Recommended: harden the existing modular application incrementally.** Keep features
moving in small approved slices while improving the path each slice uses to reach users.
Completion is demonstrated by a second developer reproducing and operating the result.

**Alternative: stabilise team development and staging only.** Lower near-term workload;
appropriate if no partner pilot is scheduled. Complete Stages 0–3 and the core of Stage 4,
but keep the remaining pilot gates visible before admitting real data.

**Alternative: rebuild the architecture and create a bespoke autonomous-agent platform.**
Potential flexibility, but greater implementation and operating burden for four people.
Defer unless measured failures show the current architecture or tooling cannot meet an
accepted requirement. Neither microservices nor new hosting is a prerequisite in this plan.

## What the inspected repository establishes

| Observation | Evidence | Implication |
|---|---|---|
| CI defines backend lint/types/tests, frontend lint/types/tests/builds for dispatcher, driver and receiver, isolated PostgreSQL 17/Redis services, one migration head, and fresh-database upgrades. | [CI](../../.github/workflows/ci.yml) | Extend existing coverage. Definition alone does not prove the current checks pass or are required by branch protection. |
| Dependency scans and the secret scan use `continue-on-error: true`. | [CI](../../.github/workflows/ci.yml) | A finding currently need not fail these checks. Establish an enforced policy after triage. |
| Destructive integration fixtures create and drop tables; missing `TEST_DATABASE_URL` causes DB tests to skip. | [fixtures](../../backend/tests/conftest.py), [test compose](../../infrastructure/docker/docker-compose.test.yml) | Prove isolation and distinguish passed, skipped and not-run checks. |
| Development Compose uses hosted Supabase, starts API/worker/Redis/dispatcher, and uses fixed container names. | [development compose](../../infrastructure/docker/docker-compose.dev.yml) | Independent agent runs need their own data, ports, containers and queues. |
| Production validation deliberately permits demo controls; production router registration can include evidence-fabrication routes when their flags are enabled. | [validation](../../backend/app/core/config_validation.py), [application](../../backend/app/main.py) | Separate demo and pilot profiles, and prove fabrication routes cannot serve in the pilot profile. This is a configuration capability, not a claim about live exposure. |
| `/health` already probes database and Redis, bounds probes and returns 503 when degraded. | [application](../../backend/app/main.py) | Add worker/evidence progress monitoring; do not duplicate the existing health check. |
| Claude has edit-time lint and backend unit-test stop hooks. Missing tools can cause hooks to skip. | [settings](../../.claude/settings.json), [lint hook](../../.claude/hooks/lint-changed.sh), [stop hook](../../.claude/hooks/test-summary.sh) | Hooks are useful feedback; portable verification and CI remain the completion evidence. |
| Tool-specific skill copies exist. Compared build-planner and bug-hunter diffs change tool/document names. | [Claude skills](../../.claude/skills/build-planner/SKILL.md), [Codex skills](../../.agents/skills/build-planner/SKILL.md) | Introduce a canonical workflow contract and intentional adapters. File hashes alone do not demonstrate harmful drift. |
| Sprint ownership is a placeholder in the repository instructions; `.github/CODEOWNERS` was absent at inspection. | [instructions](../../CLAUDE.md) | Record current owners and reviewers explicitly. |
| Documentation labels proposals and historical material separately from current references. | [documentation index](../README.md) | Preserve decision status in task preparation and retrieval. |
| Python dependency declarations mix exact versions and ranges; frontend lockfiles exist. | [requirements](../../backend/requirements.txt), frontend package lockfiles | Resolve production Python dependencies deterministically through a team-approved lock/constraints approach. |

The migration-drift note and `CLAUDE.md` still describe missing migration CI; the actual
workflow now contains those checks. Reconcile the instructions through the required
four-person review. Current database drift remains unknown.

External settings not established here include hosting regions, real vendor modes,
branch protections, required check names, deployment branch mappings, production
worker topology, backup schedules, storage retention and actual alert delivery.

## Stage 0 — agree the pilot boundary and ownership

**Visible endpoint:** another teammate can identify the current release scope, its
decision sources, the release owner and the support contact without reading a private chat.

### Packet 0.1 — publish the operating agreement

- **Goal:** define the first supported pilot and the shared definition of done.
- **Where:** new `docs/production-readiness/pilot-contract.md` and
  `docs/production-readiness/ownership.md`; current approved tickets; propose updates to
  `CLAUDE.md` through its four-reviewer process. Consider `.github/CODEOWNERS` once the
  team agrees its mappings; GitHub usernames must come from the team, not guesses.
- **Work:** name one human owner and another reviewer for each slice; nominate release,
  migration and support responsibility with a backup. Agree supported devices, usage
  envelope, vendor modes, support hours, acceptable evidence gaps, and measured recovery
  objectives. Identify approved versus proposed domain decisions. Record which deployment
  profile can use real data and which may fabricate data. Preserve project data-residency
  constraints in the proposed hosting and vendor inventory.
- **Verify:** a teammate outside the feature uses the documents to walk one actual ticket
  from stakeholder problem to acceptance evidence and identify who handles an outage.
  Record unanswered decisions as explicit blockers to the relevant packet.
- **Fence:** no change to custody semantics, receiver roles, product scope, service
  providers, academic requirements or live infrastructure by implication.

## Stage 1 — a reproducible, isolated development environment

**Visible endpoint:** a second developer starts all three surfaces and completes a
synthetic journey without writing to shared or pilot resources.

### Packet 1.1 — safe setup and environment diagnosis

- **Goal:** make setup deterministic and report missing prerequisites clearly.
- **Where:** propose `scripts/doctor.sh` and a root `Makefile`; extend
  `docs/setup.md`; add a separately scoped local/agent Compose profile under
  `infrastructure/docker/`. Coordinate changes to existing shared Compose files.
- **Work:** provide `doctor`, `dev`, `verify-fast` and `verify-full` entry points using
  the same commands locally and in CI. Set up disposable Supabase-compatible local
  services where needed, including auth/storage expectations; plain PostgreSQL alone
  does not reproduce the whole Supabase boundary. Use synthetic fixtures and mocked
  vendors for normal development. Support per-run ports, container names and Redis
  queue isolation; prevent tasks from reaching the shared broker. Show check status
  and missing variable names without printing values or inspecting secret files.
- **Verify:** from a clean environment, an implementation test exercises doctor success
  and missing-tool failure; a teammate starts API, dispatcher, driver and receiver and
  performs the agreed synthetic creation-to-confirmation flow. A parallel second run
  leaves the first run's data and queue unaffected. `verify-full` reports missing DB
  setup as incomplete rather than advertising a successful integration run.
- **Fence:** do not reset shared databases, run feature-branch migrations against
  Supabase, import real journey data, or loosen authentication to make setup pass.

### Packet 1.2 — reproducible production dependencies

- **Goal:** rebuild a release with the same resolved application dependencies.
- **Where:** backend dependency files and Dockerfile, frontend lockfiles, CI install
  steps; these are coordinated changes to shared files.
- **Work:** choose one Python lock/constraints approach, separating runtime and developer
  requirements. Keep `npm ci` for frontend clean installs. Record the source revision,
  dependency resolution and deployment artifact identifier. Define tested dependency
  updates; replace the vague instruction to use "latest" with a reviewed support policy.
- **Verify:** two clean builds resolve the same dependency versions; existing lint,
  types, tests and builds pass in CI. A deliberate dependency-resolution mismatch fails
  the reproducibility check. This does not claim byte-identical container builds.
- **Fence:** no broad framework upgrade, stack replacement or dependency bump outside
  an individually reviewed compatibility/security change.

## Stage 2 — one task contract across AI tools

**Visible endpoint:** Claude and Codex can execute the same bounded ticket and produce
comparable evidence that another human can review.

### Packet 2.1 — prepare, execute and review workflows

- **Goal:** make important context durable and completion claims verifiable.
- **Where:** propose `docs/production-readiness/task-contract.md`,
  `docs/production-readiness/task-template.md`, `.github/PULL_REQUEST_TEMPLATE.md` and
  intentional adapters under `.claude/skills/` and `.agents/skills/`.
- **Work:** keep shared workflow semantics in one versioned contract; adapters hold
  tool-specific invocation details. Every task supplies outcome, approved decision
  sources, owner/reviewer, permitted files, exclusions, dependencies, acceptance cases,
  verification commands and stop conditions. Execution reports include source revision,
  changed files, exact commands, pass/fail/skip/not-run status, and known gaps. Reviews
  start from the requirements and diff, examine adverse cases and verify selected claims
  independently. Reviewer agreement alone is not a release gate. CI checks contract
  structure, adapter references and scripts; humans review semantics.
- **Verify:** pilot the contract on two small approved tickets with different owners
  and tools. A fresh session can continue each ticket from its persisted handoff.
  Existing checks plus acceptance flows establish the implementation result. Neither
  report presents skipped integration checks as passed.
- **Fence:** preserve Git prohibitions, shared-file coordination and secret restrictions.
  No new permission to deploy, send messages or run unrestricted autonomous agents.

### Packet 2.2 — evaluate the harness itself

- **Goal:** catch instruction regressions before they affect feature work.
- **Where:** propose `harness/evals/cases/`, `harness/evals/README.md` and
  `docs/production-readiness/harness-results.md`; CI structural checks.
- **Work:** create synthetic cases covering an unapproved plan presented as a requirement,
  stale migration advice, a change requiring another owner's shared file, unsafe test
  database targeting, an incorrect interpretation of evidence, and unavailable test tools.
  Judge outcomes and prohibited actions, allowing wording to vary. Run a small human-reviewed
  benchmark when changing workflow semantics or models; record model/tool/settings and
  commit. Automated model calls require separately approved cost and credential handling.
- **Verify:** exercise the cases in isolated sessions with no real data or production
  credentials. Each identifies the expected source, boundary or incomplete check.
  Run CI structural validation using `python3 -m json.tool .claude/settings.json` and
  `bash -n .claude/hooks/*.sh scripts/update-graph.sh`, plus new contract checks.
- **Fence:** evals cannot mutate shared files or infrastructure. Do not treat an agent's
  self-score as independent proof. Rebuild Graphify only through the designated maintainer.

## Stage 3 — enforce a release candidate's checks

**Visible endpoint:** a deliberately failing candidate cannot pass the required release
checks, while a passing candidate carries test and security evidence.

### Packet 3.1 — security and merge policy enforcement

- **Goal:** turn existing scans into explicit, reviewable gates.
- **Where:** `.github/workflows/ci.yml`; reviewed scanner configuration;
  `docs/production-readiness/release-policy.md`; owner-administered GitHub settings.
- **Work:** triage existing findings and false positives, fix confirmed issues in bounded
  tickets, and enable blocking secret scanning. Define dependency risk policy with
  time-limited, named exceptions rather than blanket `continue-on-error`. Retain all
  current backend and three frontend jobs, build checks and migration checks. Verify
  branch protection actually requires the expected job names. Audit why CI references
  a Supabase service-role credential; replace it with dummy/stub configuration if the
  tested paths need no live access. Do not inspect or disclose the credential.
- **Verify:** owner runs disposable draft-PR checks with synthetic scanner fixtures;
  a deliberate test or scanner failure is red and blocks the defined merge/release path.
  Confirm clean runs and exception expiry behaviour. All normal builds/tests pass.
- **Fence:** this plan does not authorise editing remote repository settings, committing,
  pushing or merging. Keep fixtures synthetic; never introduce a real credential to test a scan.

### Packet 3.2 — production-like schema and application checks

- **Goal:** exercise application behaviour on a schema built by migrations.
- **Where:** existing migration job, `backend/tests/conftest.py`, a separate migrated-schema
  suite/profile, and isolated test Compose configuration.
- **Work:** retain the fast `create_all` fixture family; add a migrated-schema smoke suite
  with Supabase-compatible roles/auth assumptions. Exercise RLS and organisation isolation
  under relevant non-superuser roles, receiver capability expiry, and core lifecycle writes.
  Add a previous-release-to-current upgrade test using synthetic retained data and a
  reviewed schema-drift check accounting for provider-managed objects. Explicitly refuse
  shared/production database targets before destructive setup.
- **Verify:** existing CI one-head/fresh-upgrade jobs pass; smoke flows pass against the
  migrated schema. An older-release synthetic record survives upgrade with its evidence
  relationships intact. A test of the guard refuses an unsafe target before opening a
  connection. Release-mode required tests fail or report incomplete when the DB is missing.
- **Fence:** use disposable databases only. Do not fix migration conflicts unilaterally,
  change custody semantics, run shared upgrades or automate destructive downgrades.

## Stage 4 — demonstrate the journey across surfaces and failures

**Visible endpoint:** a repeatable run produces a synthetic trip whose state and evidence
can be inspected from driver, receiver and dispatcher after normal and adverse flows.

### Packet 4.1 — end-to-end evidence acceptance

- **Goal:** verify the user outcome across browser/app/API/worker boundaries.
- **Where:** propose `tests/e2e/`, a team-approved browser runner and CI/staging job;
  existing frontend tests, backend lifecycle tests and device acceptance records.
- **Work:** agree a small acceptance set: normal multi-stop journey; refused/expired
  receiver flow; organisation-crossing access attempts; upload interruption and approved
  offline recovery; duplicate submission; delayed/retried anchor. Reuse current fixtures
  and tests where they establish a case. Include browser binding cookies/CORS/HTTPS,
  worker completion, and actual supported-device permissions. Declare mocked versus live
  integration claims. Test retry/idempotency against the agreed ledger semantics.
- **Verify:** a runner completes each deterministic synthetic flow on isolated resources,
  then asserts ledger/state/file/receipt outcomes. Interrupted work remains visible and
  recoverable according to the accepted specification; retries do not duplicate logical
  events. Real-device checks demonstrate camera/GPS/native/offline behaviour for each
  device class accepted in Stage 0. Browser tests alone do not certify native behaviour.
- **Fence:** no real journeys, SMS/vendor spend or personal data in automated tests by
  default. No new biometric requirements or claims that a hash proves the physical event.

## Stage 5 — deliberate deployment with a recoverable failure path

**Visible endpoint:** a named owner promotes a verified revision to a separate staging
profile, diagnoses a simulated failure, and restores service without fabricating evidence.

### Packet 5.1 — deployment profiles and promotion

- **Goal:** distinguish demo configuration from pilot operation and track releases.
- **Where:** configuration/validation modules and their tests, deploy/runbook documents,
  separate owner-configured hosting environments and deployment workflow if adopted.
- **Work:** introduce explicit development/test/demo/staging/pilot profiles as a coordinated
  design. Reject evidence-fabrication routes in the pilot profile; require an explicit
  declaration of allowed live/mock vendor modes. Isolate databases, auth, buckets, queues,
  domains and credentials by environment. Verify regional handling against project rules,
  including API, storage, backups, monitoring and vendors. Record all frontend/native/API/
  worker versions, database revision and vendor mode in the release record. Promote the
  verified revision/artifacts deliberately; frontend native API origins are build-time
  inputs, so record their targets. Serialize migrations with a named owner.
- **Verify:** config unit tests reject unsafe pilot settings. Synthetic staging smoke
  checks confirm the expected build version, DB/Redis health, normal handover and absence
  of fabrication routes. Rehearse application rollback on compatible schema and document
  roll-forward handling for incompatible database changes. Owner verifies required status
  and deployment approvals in the actual hosting path; GitHub settings do not govern a
  provider's independent auto-deployment by themselves.
- **Fence:** do not break the existing demo profile or loosen cookie/IP-trust rules.
  Real promotion, provider changes and shared migrations need the appropriate human action.

## Stage 6 — observe and recover evidence, then admit the pilot

**Visible endpoint:** the support owner receives a useful alert, traces the affected
synthetic journey and restores records and original files in an isolated recovery drill.

### Packet 6.1 — monitoring and incident response

- **Goal:** detect failed evidence work even when `/health` is green.
- **Where:** logging/middleware, worker and anchor instrumentation, monitoring configuration,
  `docs/production-readiness/incident-runbook.md`; coordinate shared application changes.
- **Work:** add redacted correlation IDs across API and background tasks; sanitise paths
  containing handover capability tokens as well as payloads and headers. Measure queue
  age, worker heartbeat, anchor retry age/failure, upload failure, API errors/latency and
  pool waits. Establish thresholds from the pilot usage envelope and measured baseline.
  Retain the existing DB/Redis probe; evaluate separate liveness/readiness semantics for
  the chosen host so an external outage does not cause harmful restart loops. Define
  named notification routing, support hours, escalation and evidence-preserving actions.
- **Verify:** stop a worker and stall anchoring in isolated staging; an alert identifies
  the affected operation and reaches the designated test recipient through an explicitly
  authorised channel. The support owner follows the runbook to recovery. Redaction tests
  confirm logs contain neither tokens, identities, raw location/photo content nor secrets.
- **Fence:** no customer data copied into AI chats or third-party telemetry. Logging and
  monitoring services must meet agreed data handling/residency; no messages without authorisation.

### Packet 6.2 — backup, restore and pilot acceptance

- **Goal:** prove that the evidence survives infrastructure failure.
- **Where:** owner-managed DB/object backup configuration, restore tooling,
  `docs/production-readiness/restore-runbook.md` and `pilot-acceptance.md`.
- **Work:** agree recovery time/data-loss objectives; preserve original authorised objects
  alongside DB metadata, committed payloads and receipt references. Define retention,
  deletion, restricted access, backup encryption and consistent snapshot handling.
  Restore a synthetic set to isolated resources, including needed auth/application
  relationships. Determine operational capacity with the agreed trip/device/upload
  mix and worker throughput. Record pilot limits, participant support arrangements and
  stop conditions based on observed missing evidence, isolation failure or backlog.
- **Verify:** restore DB records and original evidence files, compare hashes and exercise
  the current verifier and journey view. Record recovery duration and the recoverable
  point rather than claiming objectives without a drill. A different teammate executes
  the restore/runbook. Replay the accepted pilot workload, record latency/backlog/errors
  against agreed thresholds, and complete all Stage 0 device/vendor acceptance gates.
- **Fence:** do not restore over shared/production services, retain real data indefinitely,
  or claim recovery of a physical fact merely from checking its stored hash.

Supabase database backups cover storage metadata, not Storage API objects. Object
backup must therefore be a deliberate part of this drill, not an inferred provider feature:
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

## Sequence and capacity

Work in the stage order for the main delivery path. Ownership and independent operational
research can proceed alongside environment/harness work, but do not defer recovery until
after real evidence is collected. Each packet becomes one or more session-sized tickets
only after the target files, owner and verification setup are confirmed. Large packets
such as migrated-schema testing and native acceptance need multiple tickets; no estimate
here asserts they fit one session.

For the next planning cycle, prioritise: (1) owners/pilot contract, (2) isolated setup and
common verification entry points, (3) portable task contract, (4) scanner enforcement and
pilot-safe config, (5) one end-to-end journey. Start restore and monitoring discovery during
that cycle. Allocate a bounded weekly harness-maintenance session; expand only when the
team's measured time saving justifies it. Avoid a promised calendar delivery date until
each owner has estimated the packets and the pilot boundary is confirmed.

## Risks, early warnings and fallbacks

| Risk | Tripwire | Response |
|---|---|---|
| Environment work expands into recreating every vendor. | Stage 1 cannot complete a synthetic journey without live credentials. | Stub vendor boundaries and prioritise the minimum Supabase-compatible flow; keep live integration acceptance as a separate gate. |
| AI increases review and integration burden. | Pilot tickets require more total human correction/review time, or review age rises. | Reduce task size and agent concurrency; improve context from actual failures before adding agents. |
| Automatic provider deployments bypass checks. | Hosting branch mappings allow serving a revision before required CI passes. | Correct the owner-managed promotion path and verify it with a disposable candidate before real release. |
| Demo data crosses into pilot evidence. | Pilot config accepts fabrication routes or a synthetic queue/bucket is shared with real data. | Block pilot admission and isolate resources; preserve existing demo operation separately. |
| Backup is metadata only. | Restore produces records but cannot retrieve original files or verify their hashes. | Keep pilot closed; add coordinated object preservation and repeat the drill. |
| Rules or graph references become stale. | A task follows a historical statement contradicted by source or approved decision. | Reconcile through the required review; maintainer refreshes graph. Do not execute proposed/historical scope. |

## Definition of pilot-ready

- [ ] A named owner and reviewer can explain and defend each accepted change.
- [ ] A second developer reproduces the isolated environment and acceptance journey.
- [ ] Required CI checks and scanner policies are enforced on the actual release path.
- [ ] Application checks run on a migrated schema; previous-release data survives upgrade.
- [ ] Cross-organisation and receiver capability boundaries have acceptance evidence.
- [ ] Device, offline, vendor failure and retry behaviour match the agreed supported profile.
- [ ] Pilot deployment excludes fabrication controls and names all deployed revisions.
- [ ] Data handling, access, retention and regional placement have been verified by owners.
- [ ] Worker/evidence failures trigger useful redacted alerts with named support responsibility.
- [ ] Another teammate restores records and original files in an isolated recovery drill.
- [ ] Pilot usage limits and recovery objectives have measured evidence.
- [ ] Stakeholder scope and evidence claims remain within approved product boundaries.

## Measure whether the harness helps

For the initial tickets, record total human preparation, supervision, review, repair and
integration time plus allocated harness maintenance. Track review age, escaped defects
and release failures; report passed/skipped/not-run checks distinctly. Compare similar
tasks without claiming causality from a few examples. Increase autonomy only for task
classes whose completion and failure handling are demonstrated. Maintain the ability to
explain the implementation without the original chat.

## Sources and limitations

- [Repository rules](../../CLAUDE.md), [setup](../setup.md),
  [deployment runbook](../deployment-runbook.md), [documentation index](../README.md).
- [Historical migration drift note](../design-notes/2026-09-15-alembic-autogenerate-drift.md):
  retain its safety rationale; current CI supersedes its migration-CI description.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  and [deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments):
  support required checks and deliberate deployment controls; verify plan/repository applicability.
- [DORA small batches](https://dora.dev/capabilities/working-in-small-batches/):
  informs bounded increments and fast feedback; it does not promise a productivity gain here.
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups):
  informs the distinct requirement to preserve original Storage objects.

Source inspection supports this roadmap's priorities, not a declaration that production
is secure or ready. No test outcome or live configuration is certified by this proposal.
