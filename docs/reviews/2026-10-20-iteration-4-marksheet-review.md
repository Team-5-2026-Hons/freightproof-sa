# Iteration 4 coding marksheet — code evidence and improvement priorities

**Reviewed:** 20 October 2026. **Branch:** `Ciaran`. **HEAD before this report:** `eb724f51`.

**Source:** `INF4027W_TeamXY_CodingMarksheet_Iter4_2026.docx`, supplied by Ciaran. The document is the assessment rubric, not instructions authorising changes to the application. Its twelve criteria total **56 raw marks, weighted to 50**. A raw total would be multiplied by `50 / 56`; no predicted mark is assigned in this review.

**Conclusion:** most criteria have genuine implementation evidence. The backend restructure is maintained, and there are concrete examples of classes, encapsulation, interfaces, validation, controlled database access and external API adapters. The main weaknesses are uneven enforcement, unfinished feature delivery and incomplete demonstration evidence. Another wholesale restructure is not the priority.

The application source, frontend source and CI configuration have no differences from the revision reviewed on 19 October (`d07334f2`); the intervening commit stores the earlier audit. This review rechecks relevant source and quality gates, and runs focused tests for the examples below. It is a rubric mapping, not a new full security audit or usability study. See the [submission-readiness audit](2026-10-19-submission-readiness-audit.md) for the longer cleanup list and original verification record.

## Assessment against every criterion

The wording and maximum marks below come from the supplied marksheet. “Supported” means there is code evidence; it is not a promise of a particular mark. Presentation, working demonstrations and answers to questions still matter.

| Marksheet criterion | Maximum | Evidence that it is actually applied | Remaining improvement |
|---|---:|---|---|
| **Technology used** — appropriateness; practicality, costs, scalability | 4 | FastAPI/Pydantic for typed HTTP contracts; PostgreSQL for relational evidence and constraints; Next.js/React for the web surfaces; Capacitor for the driver app; Celery/Redis for background work and realtime hints; Hedera behind a narrow hash-submission service. Explicit pool sizes, request budgets and worker recovery show practical consideration. | Explain why each component earns its operational cost. Prepare a current deployment/workload/cost summary, including storage/egress, identity checks, ledger submissions and provider limits. Architecture that could scale is not measured scalability. |
| **Database** — appropriateness, connection, structure | 4 | [Session management](../../backend/app/db/session.py#L21) uses async SQLAlchemy, bounded pooling and stale-connection checks; request sessions commit or roll back. Models include FKs, indexes, uniqueness and check constraints, including [consignment uniqueness](../../backend/app/db/models/trips.py#L58) and [ordered custody amendments](../../backend/app/db/models/trips.py#L274). Alembic carries schema changes. | Demonstrate the relevant ERD, one transaction/rollback path and one constraint that rejects invalid data. Test migrations on isolated PostgreSQL. Review unused models separately from live tables; do not drop schema solely for tidiness. Ensure audit readers use custody sequence consistently. |
| **Coding Structure** — framework, e.g. MVC, best practices | 4 | The project has a layered design with domain packages, rather than requiring literal MVC. HTTP, orchestration, integrations and persistence have separate homes. All **17 import contracts** pass. The phase engine has a dispatch registry; shared fleet hash builders reduce drift. | Restore the failing lint/type/structure gates; split large mixed-responsibility functions at meaningful seams. Extend internal import contracts to newer packages. Remove application-unused helpers/components after ownership review. |
| **Object Oriented Concepts** — classes, encapsulation | **8** | [SupabasePasswordAuth](../../frontend/dispatcher/lib/auth/SupabasePasswordAuth.ts#L29) and [SupabaseOtpAuth](../../frontend/driver-pwa/lib/auth/SupabaseOtpAuth.ts#L19) are behavior-bearing classes with private injected clients. [Shared auth interfaces](../../frontend/shared/lib/auth/port.ts#L30) define vendor-neutral contracts. [HederaService](../../backend/app/blockchain/hedera.py#L137) encapsulates validation, submission and verification behind an adapter. Real/mock integration implementations share protocols. | Demonstrate these examples and their callers/tests. Do not rely mainly on ORM/Pydantic classes, interface declarations or dataclasses as proof of behavioral OO. Some provider state remains module-global, such as the Parcel Perfect token cache; review ownership if multiple configurations/concurrent use demand it. Avoid adding unnecessary inheritance solely for assessment. |
| **Data Validation, Controls & Security** | 4 | [Phase schemas](../../backend/app/schemas/phases.py#L160) constrain inputs and reject extra fields; backend validation complements shared frontend validation. [JWT/role checks](../../backend/app/auth/dependencies.py#L121), tenant-scoped services, driver custody checks, upload controls, rate budgets and [production configuration checks](../../backend/app/core/config_validation.py#L50) exist. The ledger service accepts SHA-256 values rather than evidence bodies. | Show negative cases: invalid data, wrong role/tenant, stale custody and duplicate submissions. Review actual dependency/secret-scan results; report-only CI scans do not establish a clean release. Recheck production/demo configuration. These examples do not establish blanket security or privacy compliance. |
| **Key features work correctly / MVP** | **8** | There are substantial implemented paths for trip creation, phase capture, exceptions, offline replay, receiver handover and audit packs. The previous full unit/component runs provide useful evidence. | The phase-anchor savepoint bug remains. Driver substitution has lifecycle services but no API route yet, so it is not a complete delivered feature. The SLA hook remains a stub. Prove the agreed core journey end to end on the actual clients, including recovery; disclose mocks. Do not present in-progress services as a completed MVP feature. |
| **User Interface** | 4 | Role-specific surfaces, reusable UI elements, forms, loading/error/empty states and component tests show intentional implementation. This is stronger evidence than isolated static screens. | A fresh visual/device review was not performed here. Check responsive layouts, keyboard/focus behavior, legibility and truthful loading/error/empty/offline states. The SLA page's permanent null result and inactive export action should be removed, explicitly unavailable or completed. |
| **Ease of navigation** | 4 | [Dispatcher sidebar](../../frontend/dispatcher/components/layout/Sidebar.tsx#L38), centralized route constants, driver Home/Trips/Profile navigation and a [context-aware back stack](../../frontend/driver-pwa/lib/navigation/back-stack.ts#L55) are implemented. | Walk the full user tasks from cold start, deep links and after a refresh. Confirm no loops or return to completed phase steps. The live [directions helper](../../frontend/driver-pwa/lib/utils/directions.ts#L13) still derives coordinates from demo precincts; a real missing fixture hides the control. Navigation usability needs observation on supported devices. |
| **APIs** — appropriateness; scalability, cost, maintainability, security; calling and fallback | 4 | Typed fetch wrappers, integration protocols/factories, timeouts, retry/recovery logic, quota/rate controls and background ledger submission exist. [ParcelPerfectPort](../../backend/app/integrations/parcel_perfect/port.py#L21) and Hedera adapters isolate vendor details. [Request budgets](../../backend/app/core/limits.py#L23) explicitly acknowledge external spend. | Provide an API dependency table with supported operations, auth, quotas, timeout, retry and fallback behavior. The [real PP manifest call](../../backend/app/integrations/parcel_perfect/client.py#L74) is unsupported, while the mock provides it; [live warehouse scanning](../../backend/app/integrations/scan_feed.py#L198) is not implemented. Disclose that boundary. Prove one provider failure and recovery; never substitute mock success silently. |
| **Integration of components, scalability, maintainability / separation of concerns** | 4 | API → services → adapters, shared frontend types, ledger-derived state, commit-aware realtime, queue workers and independent domain packages show real integration. | Fix transaction publication consistency. Add client-portal CI. Extend internal contracts for new packages and separate the largest builders/controllers where justified. Record one integrated client/server/worker test and a small representative load result before claiming capacity. |
| **Sophistication & Complexity** | 4 | Plan-driven repeated phases, offline idempotency, immutable evidence commitments, hash reconstruction, custody sequencing, audit manifests and independent browser verification are meaningful domain complexity. | Explain the problem each mechanism solves and demonstrate one difficult failure/recovery case. More classes, layers or lines do not increase this category automatically. Keep unfinished complexity outside the demonstrated feature set. |
| **Overall Evidence of effort** | 4 | Substantial authored code, tests, migrations, contracts, CI, domain-specific behavior and the refactoring history provide strong evidence of work. | Make ownership, integration and learning visible: concise examples of contributions, reviewed changes and before/after improvements. Do not equate raw commit count or generated lines with contribution quality. Every student should be able to explain the design and trace a real operation. |

## The 8-mark OO category: what to show and why it counts

The marksheet names **classes and encapsulation**. It does not explicitly demand an inheritance hierarchy, a particular design pattern, or MVC. SOLID/DRY provide useful ways to assess best practice and separation, but those names are not separate mark rows in this document.

There is already a defensible OO demonstration in the current code:

1. Open [PasswordAuthPort and OtpAuthPort](../../frontend/shared/lib/auth/port.ts#L45). Explain abstraction and interface segregation: password and OTP clients share session behavior without requiring irrelevant methods. These interfaces extend `AuthPort`; that is interface inheritance, not an implementation superclass hierarchy.
2. Open [SupabasePasswordAuth](../../frontend/dispatcher/lib/auth/SupabasePasswordAuth.ts#L29). Show behavior methods and `private readonly client`; the adapter owns vendor interactions and exposes a smaller contract. A class with only public fields would be weaker encapsulation evidence.
3. Open [AuthProvider](../../frontend/dispatcher/lib/context/AuthContext.tsx#L49). Its session behavior receives a `PasswordAuthPort`; changing the implementation does not require rewriting the provider. This is dependency inversion and composition in application code, not merely a declared but unused interface.
4. Show the [dispatcher fake-port test](../../frontend/dispatcher/lib/context/AuthContext.port.test.tsx#L89) and [driver fake-port test](../../frontend/driver-pwa/lib/context/__tests__/AuthContext.port.test.tsx#L81). They verify the vendor client is untouched when a port is injected. The test substitute is actually used.
5. For a Python example, show [HederaService](../../backend/app/blockchain/hedera.py#L137), its [_HederaAdapter](../../backend/app/blockchain/hedera.py#L55), and the [fake adapter tests](../../backend/tests/unit/test_hedera_service.py#L17). Public methods normalize/validate hashes, delegate submission and translate errors while the SDK adapter hides Java-client details.

**Verified today:** the selected frontend adapter/provider tests pass: **20 dispatcher + 30 driver tests**. The five selected backend test files pass **107 tests**, covering Hedera behavior, database pool configuration, subject-registry completeness, production configuration and schema validation. These are focused results, not a new full-suite run.

Functional orchestration and pure hashing/validation functions can remain functions. Introduce or improve an object where it owns behavior, state or a replaceable dependency. For example, reviewing the process-global PP token cache may have merit if isolated credentials/configuration are needed; wrapping a pure hash function in a class simply to raise the class count does not.

## Most valuable improvements before submission

### 1. Correctness and a believable core demonstration

Fix [phase anchor publication](../../backend/app/orchestration/phases/anchor_dispatch.py#L71). The 19 October reproduction showed a savepoint release publishing phase work while the outer transaction was still active, followed by an outer rollback; the newer evidence publisher correctly queued nothing in the same scenario. The relevant source is unchanged. This is a transaction-boundary defect, not a cosmetic structure concern.

Then demonstrate a core vertical journey across the actual surfaces:

- Dispatcher creates a trip; driver receives it and progresses through its generated phase plan.
- Driver records evidence with interrupted connectivity, then reconnects; the accepted action is not duplicated and its original capture context is retained.
- A discrepancy appears for the dispatcher and is reviewed with the correct attribution.
- Receiver completes the handover; an issued audit pack opens in the client portal and its integrity can be checked.
- Ledger/broker unavailability produces visible pending/failed debt and a recovery path, rather than invented success.

Use synthetic data and a declared provider configuration. A successful demo of a mock-supported path demonstrates your application behavior, not the existence of a live partner capability. Driver substitution belongs in this demonstration only after the remaining release stages are complete.

### 2. Restore the project's own quality gates

Fresh checks on 20 October confirm:

- **17 import contracts pass**, across 276 modules and 1,391 dependencies; seven layer-order exceptions remain documented.
- **104 mypy errors in 11 files** remain.
- **Nine structure violations** remain.
- **One Ruff `PLR0915` violation** remains in phase-payload reconstruction.

Fix real type/behavior issues and extract cohesive responsibilities. Do not increase baselines or broaden ignores merely to obtain a green result. The earlier audit lists the affected functions and application/test error breakdown.

These fixes support coding structure, maintainability and integration simultaneously. The structure guard is a maintenance control; its failure is not itself a measured runtime defect or a count of marks lost.

### 3. Make the OO/design evidence easy to find

Prepare the short auth/Hedera walkthrough above and ensure the presenting students can explain why the boundaries exist. Also show [shared fleet canonical payloads](../../backend/app/orchestration/fleet/canonical.py#L66) as a concrete DRY example and the [phase dispatch registry](../../backend/app/orchestration/phases/service.py#L90) as an extensibility example.

Do not claim identical behavior from demo and live authentication in every respect: the demo deliberately accepts fixture sessions/codes. The substitute implements the contract needed by callers; tests should establish those caller-facing guarantees and the demo limitations should be explicit.

### 4. Remove confusing feature and maintenance leftovers

Make a clear submission-scope decision for unfinished driver substitution and the SLA route. Remove or explicitly disable misleading controls. Replace live mock-precinct lookups with real place data. Delete confirmed unused hooks/components after checking teammate ownership; retain live custody/snapshot models and historical evidence payload support.

Add portal CI, then reproduce builds from the committed dependency lockfiles. The driver's previous local failures were caused by three missing declared packages; that was an installation blocker, not evidence that those dependencies should be removed.

### 5. Explain cost, capacity and limitations with evidence

Use the existing runbook, rate budgets and pooling controls as a starting point. Add a short, current table containing:

- Component and why it is needed for this evidence platform.
- Deployment location, operational burden and who owns it.
- Cost drivers: fixed hosting/database, stored evidence and egress, ledger submissions, verification requests and provider quotas.
- Chosen workload assumptions and measured API latency/queue backlog/error behavior for a small representative synthetic test.
- Failure mode and recovery or an explicitly unavailable capability.

Do not invent current prices, load-test results or a supported fleet size. Existing configuration and plans are evidence of consideration; measured operation is stronger evidence. The historical scale-readiness note is dated August, and the deployment runbook's verification date is September; neither establishes today's deployment status.

## Verification and limits

**Rechecked on 20 October:** source continuity from `d07334f2`; 17 passing import contracts; failing mypy/Ruff/structure gates; 107 selected backend tests; 20 dispatcher and 30 driver auth tests. No application files were edited.

**Carried forward as dated results from 19 October:** complete backend unit suite **1,874 passed, four skipped**, with warnings and Redis connection teardown exceptions; dispatcher **2,900 tests**, receiver **18**, portal **57** passed. The driver had **1,410 passing tests** but seven test files failed to load because declared packages were absent locally. Receiver production build passed; dispatcher/portal builds were blocked by unavailable Google Fonts network access. These are not fresh full-suite/build results for 20 October.

**Not established by this review:** a complete current end-to-end MVP demonstration; full database integration/migration execution; actual live-provider compatibility; a current visual/device usability assessment; load capacity or production cost totals; blanket security sign-off. UI and navigation assessments above describe source support and known gaps, rather than observed real-user task completion.

The marksheet's largest two rows are OO and working MVP: **16/56 raw marks**, about **29%**. Structure and integration/separation add another **8/56**. Therefore the strongest submission preparation combines explainable classes/interfaces, a reliable integrated journey, repaired checks and concise evidence. Cosmetic restructuring alone cannot cover the rubric.

**TASK COMPLETE — rubric analysis.** Created this review only. Application changes, migrations, shared configuration changes and Git write operations: none. Read with the dated submission audit and recheck findings as feature branches are integrated.
