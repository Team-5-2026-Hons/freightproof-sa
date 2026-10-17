# Seal OCR and Linehaul Scan to PDF — Design

**Status:** Approved in brainstorming, awaiting spec review · **Date:** 2026-10-15 · **Author:** Tim (with Claude)
**Ticket:** FP-300 (seal OCR). The linehaul scan has no ticket; Jira is not to be edited from this work.
**Branch:** `feat/fp-300-seal-ocr-linehaul-scan`

---

## 1. Problem

**Seal.** At departure and at arrival the driver types the seal number and, separately,
photographs the seal. Nothing links the two. The panel asked for the number to be read
from the photo, or at minimum for the photo to check the typed number. `CaptureSeal.tsx`
already admits that a re-typed number "proves nothing the photograph doesn't".

**Linehaul.** At loading the driver photographs the linehaul sheet with the plain camera.
The result is a skewed phone photo. Dispatchers and insurers want a document they can
read, print and file: a flat, cropped page in a PDF.

## 2. Decisions

| # | Decision | Rejected alternatives |
|---|----------|-----------------------|
| D1 | Upgrade the driver app from Capacitor 6 to **Capacitor 7**. | Corner-crop in JS (no auto edge detection); local Swift/Kotlin plugin (native code to defend at examination). No maintained document scanner supports Capacitor 6: `@capgo/capacitor-document-scanner` and `@capacitor-mlkit/document-scanner` both start at 7.x. |
| D2 | **Native document scanner**, `@capgo/capacitor-document-scanner@7.2.x` (VisionKit on iOS, ML Kit on Android). The app builds the PDF itself with `pdf-lib`. Browser PWA: a PDF of the uncropped photo. | opencv.js in the browser (~8 MB offline download, slow on cheap phones); server-side OpenCV (heavy Python dependency, needs signal at submit). |
| D3 | **Native OCR**, `@capacitor-community/image-to-text@7` (ML Kit on Android, Apple Vision on iOS). The browser PWA keeps manual typing. | tesseract.js, alone or as a browser fallback: several MB of WASM to precache and weaker on curved or worn seal text. |
| D4 | **Both the linehaul image and the PDF are anchored.** The loading payload moves to **v3**, which adds `linehaul_pdf_sha256`. | PDF alongside but unanchored; PDF replacing the photo. |
| D5 | The scanner returns only the cropped, flattened page, never the raw camera frame. **The scanned page JPEG is the anchored `linehaul_photo`**, and the PDF wraps that same image. | Asking for both a plain photo and a scan (an extra step at every pickup). |
| D6 | **How the seal number was captured is stored but not anchored**: `seal_number_source` on `phase_events`. Departure and arrival payloads are unchanged. | Anchoring it (two more payload versions plus verifier and snapshot churn). |
| D7 | **The PDF is a clean image PDF**: one A4 page with no text layer. | A searchable PDF with an OCR text layer. |

## 3. Scope

Three stages, built in this order. Each one ends in something that works on a device.

- **Stage A:** Capacitor 6 → 7 in `frontend/driver-pwa` only. No feature changes.
- **Stage B:** Seal OCR at departure and arrival, plus the `seal_number_source` record.
- **Stage C:** Linehaul scan, PDF and loading anchor v3.

**Out of scope:**
- Searchable PDFs.
- OCR in the browser.
- Changing the `XX-####` seal format.
- Anchoring `seal_number_source`.
- Showing `seal_number_source` in the dispatcher UI (Ciaran's area; he gets the API field) or in the audit pack (a possible follow-up).
- Rewriting historical loading receipts (they stay v2 and keep verifying).
- Anchoring in-transit checkpoints (FP-63) or driver-raised exceptions (FP-290).
- Any Jira change.

## 4. Stage A: Capacitor 6 → 7

**Current state:** `@capacitor/core` 6.2.1, Android `minSdk` 22, `compileSdk`/`targetSdk` 34,
AGP 8.2.1, Gradle 8.2.1, iOS deployment target 15.0.

**Change:**
- Bump every `@capacitor/*` package in `frontend/driver-pwa/package.json` to 7.x: core, cli, android, ios, camera, geolocation, haptics, push-notifications and status-bar.
- Run `npx cap migrate`. On Android it moves `minSdk` to 23, `compileSdk`/`targetSdk` to 35, AGP to 8.7.x and Gradle to 8.11.x, and updates the AndroidX versions in `variables.gradle`.
- iOS already meets the 14.0 minimum.
- Re-sync both platforms.
- Check Java 21 is available for the Android build.

**Shared-file impact:** `frontend/driver-pwa/package.json` is a shared file. Flag it to the
team before merging. No other app uses Capacitor: the dispatcher and receiver do not.

**Done when:**
- The driver app's `tsc`, lint, vitest and build all pass.
- The APK and the iOS build both launch on a device.
- Camera, geolocation, push permission and the status bar behave as before.
- No feature code changes in this stage.

## 5. Stage B: Seal OCR

### 5.1 Driver flow (departure and arrival)

1. The photo comes first, then the number.
2. The driver photographs the seal. The number field shows "Reading seal…" for up to
   `SEAL_OCR_TIMEOUT_MS` (4000). The driver can type while OCR runs.
3. A single match pre-fills the field with the note *"Read from the photo — check it
   matches the seal."* The driver confirms or edits it.
4. If OCR finds nothing, finds several different matches, times out, throws, or runs in
   the browser, the driver types the number. The one exception: a number an earlier read
   filled, which the driver never touched, is cleared, because it came from a photo that
   has since been replaced. The swipe waits for a read in progress, at most
   `SEAL_OCR_TIMEOUT_MS`, so the capture tag always describes the current photo. In the
   browser there is no read and no wait.
5. **The driver's own typing is never overwritten.** A new OCR result only fills the field
   if the field is empty or still holds the previous OCR result.
6. **Arrival stays a blind entry.** The reading comes from the photo of the physical seal,
   never from paperwork or from the departure value. When the condition is `missing`, OCR
   is skipped and the existing clearing behaviour stays.

### 5.2 Frontend units

- **`lib/ocr/parseSeal.ts`**, pure: `parseSealCandidates(text: string): string[]`.
  1. Uppercase the text.
  2. Find every 2-character + optional space or dash + 4-character run.
  3. Map look-alike characters by position: on the letter side `0→O`, `1→I`, `5→S`, `8→B`; on the number side `O→0`, `I→1`, `L→1`, `S→5`, `B→8`.
  4. Normalise to `XX-####` and keep only values that pass `isValidSealFormat`.
  5. Return the distinct values.
- **`lib/ocr/readSeal.ts`**: `readSealFromPhoto(dataUrl: string): Promise<SealReading>`, where
  `SealReading = { kind: 'found'; value: string } | { kind: 'none' } | { kind: 'unavailable' }`.
  - Returns `unavailable` when `!Capacitor.isNativePlatform()`, and on a plugin error (logged with `console.warn`) or a timeout.
  - Otherwise it calls `ImageToText.detectText`, joins the detected text, and parses it. Exactly one candidate gives `found`; anything else gives `none`.
- **`lib/ocr/sealSource.ts`**, pure: `sealNumberSource(ocrValue: string | null, finalValue: string): SealNumberSource`.
  - Equal values → `ocr_confirmed`.
  - An OCR value that differs from the final value → `ocr_corrected`.
  - No OCR value → `typed`.
- **`lib/types/evidence-draft.ts`** gains `sealNumberOcr: string | null` on `DepartureEvidence` and `sealNumberAtArrivalOcr: string | null` on `ArrivalEvidence`. A retake resets it.
- **`CaptureSeal.tsx`, `SealInput.tsx` and `SealVerify.tsx`:** the photo moves above the number, `readSealFromPhoto` runs after capture, and the pre-fill rules apply. The early upload is unchanged.
- **`lib/api/phases.ts`** sends `seal_number_source` from `sealNumberSource(...)` for departure and arrival.
- **Shared type:** `SealNumberSource` goes into `frontend/shared/lib/types/phase.ts`, because the dispatcher will read it from `PhaseEventRead`. `shared/` is read-only for Tim, so this one-line type addition must be cleared with the team first. The fallback is to define the type locally in the driver app.

### 5.3 Backend

- `db/models/enums.py`: `SealNumberSource(str, Enum)` with `OCR_CONFIRMED`, `OCR_CORRECTED` and `TYPED`.
- `db/models/phases.py`: `seal_number_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)`. It's a plain string column like `seal_condition`, so new values need no migration. It is set on departure and arrival rows; NULL means unknown, from an older client or a replayed queue entry.
- `schemas/phases.py`: `DepartureCompleteRequest` and `ArrivalCompleteRequest` get `seal_number_source: Optional[SealNumberSource] = None`. `PhaseEventRead` exposes it.
- `advance_departure` and `advance_arrival` store it. **They do not add it to any canonical payload.**

### 5.4 Stage B tests

- **`parseSeal`:**
  - a clean match
  - spaces or no dash
  - look-alikes on each side
  - several distinct candidates
  - none
  - the same candidate repeated counting as one
- **`sealSource`:** all three results.
- **`readSeal`** with the plugin mocked: native found, none, several, throw, timeout; web is `unavailable`.
- **Component tests** for `CaptureSeal` and `SealVerify`:
  - pre-fill on a match
  - no overwrite after the driver types
  - retake refills when the field is untouched
  - browser path leaves the field empty
  - arrival `missing` skips OCR
- **Backend:**
  - The value is accepted, stored and exposed.
  - Absent stores NULL.
  - An invalid value returns 422.
  - The departure and arrival anchored payloads are unchanged (existing payload tests and the B3 snapshot stay green).

## 6. Stage C: Linehaul scan, PDF and loading anchor v3

### 6.1 Driver flow

- **Native:** the linehaul step's `CameraCapture` becomes a "Scan the sheet" control that
  calls `DocumentScanner.scanDocument` with one page and crop adjustment allowed. Cancelling
  leaves the step unchanged with nothing captured.
- **Browser:** the existing camera input; the PDF is built from the uncropped photo.
- The step requirement "Sheet scan" is met once the image exists. If the PDF build fails,
  the step still completes: the image goes up as `linehaul_photo` and no PDF is sent.

### 6.2 Frontend units

- **`lib/scan/scanLinehaulSheet.ts`**: `scanLinehaulSheet(): Promise<string | null>` (a JPEG data URL, or null when cancelled). Native only. Plugin 7.2.5 has no scanner-mode option: `letUserAdjustCrop: false` selects ML Kit's base mode (crop and rotate, no ML clean-up that could alter the document), and iOS uses plain VisionKit.
- **`lib/scan/buildLinehaulPdf.ts`**: `buildLinehaulPdf(jpegDataUrl: string): Promise<string>` (a PDF data URL). It uses `pdf-lib`.
  - One A4 page with the image fitted inside `PDF_PAGE_MARGIN_PT` margins.
  - It takes the image as captured: both capture paths already cap it at 1600 px and JPEG quality 70 (the evidence-photo constants shared with `CameraCapture`), which keeps the PDF small enough for drafts and the offline queue, both stored in a ~5 MB `localStorage`.
  - Title metadata is "Linehaul sheet", with creation and modification dates cleared.
- **`Linehaul.tsx`:**
  - Captures the scan (native) or photo (browser).
  - Uploads the JPEG early as `photo`/`linehaul_photo`, then builds and uploads the PDF early as `document`/`linehaul_pdf`.
  - Both data URLs stay in the draft as the submit-time fallback.
- **`lib/types/evidence-draft.ts`** gains `linehaulPdfDataUrl` and `linehaulPdfArtifactId` on `LoadingEvidence`.
- **`lib/api/artifacts.ts`:** the upload filename extension follows the blob's MIME type (`.pdf`, `.jpg`) instead of always `.jpg`.
- **`lib/api/phases.ts`:** loading sends `linehaul_pdf_artifact_id`, falling back to a submit-time upload like the photo does.
- **New dependencies** in `frontend/driver-pwa/package.json` (a shared file, flagged with
  Stage A): `@capgo/capacitor-document-scanner@7.2.x` and `pdf-lib@1.17.1`. Stage B adds
  `@capacitor-community/image-to-text@7.0.0`.
- **`EvidenceRole`** in `frontend/shared/lib/types/evidence.ts` gains `'linehaul_pdf'`. This is a shared file, so the same clearance as §5.2 applies; there is no local fallback, because the type is used across the app.

### 6.3 Backend

- `EvidenceRole.LINEHAUL_PDF = "linehaul_pdf"`. The enum's naming rule already implies the column `linehaul_pdf_artifact_id` and the hash key `linehaul_pdf_sha256`.
- `db/models/phases.py`: `linehaul_pdf_artifact_id`, a nullable FK to `evidence_artifacts.id` with `use_alter=True` and the name `fk_phase_linehaul_pdf`, matching its siblings.
- `schemas/phases.py`: `LoadingCompleteRequest.linehaul_pdf_artifact_id: Optional[UUID] = None`. A model validator rejects the same id being given for photo and PDF.
- **`advance_loading`:**
  - Cites both roles through the existing attribution check (trip ownership and role).
  - Additionally requires the PDF artifact's stored MIME type to be `application/pdf`, returning 422 otherwise.
  - Stores the id and passes both hashes to the v3 payload.
  - The upload allowlist already sniffs `%PDF-`, and the 10 MB limit already applies.
- **`orchestration/phases/payloads.py`:** `PHASE_PAYLOAD_VERSION_V3 = 3` and `compute_loading_canonical_payload_v3`. That's the v2 keys plus `linehaul_pdf_sha256`, which is always present and None when there is no PDF. New loading completions anchor v3; the v2 function stays for verification.
- **`orchestration/verification/phase_payloads.py`:** accepts v3 **for loading only**, rebuilding from the stored PDF artifact hash. Every other phase still accepts only v2. Existing v2 and legacy loading receipts keep verifying.
- **Audit pack builder:** add `"linehaul_pdf"` to the evidence roles so the insurer pack includes the PDF. The manifest snapshot gains only that addition.

### 6.4 Migration

One migration covering both stages, named
`2026_10_15_tim_add_seal_source_and_linehaul_pdf.py`. It adds `phase_events.seal_number_source`
and `phase_events.linehaul_pdf_artifact_id` with its FK. Before generating:
1. `git fetch origin` and check for unmerged migrations on `dev`.
2. Re-chain onto the `dev` head.
3. After autogenerate, prune every operation not listed here, in both `upgrade()` and `downgrade()`, and verify with `grep -nE "op\.[a-z_]+\(" <file>`.
4. Never run `alembic upgrade` against the shared database from this branch.

### 6.5 Stage C tests

- **`buildLinehaulPdf`:**
  - The output starts with `%PDF-`.
  - It has one page sized A4.
  - The image is embedded.
  - It stays under the size target for a 4000px input.
- **`Linehaul` component** with the scanner mocked:
  - a scan uploads the JPEG and the PDF
  - cancel leaves the step unchanged
  - browser fallback
  - a PDF build failure still completes with the photo only
- **Backend:**
  - Loading with and without a PDF anchors v3 with the right `linehaul_pdf_sha256` or None.
  - An image cited as the PDF returns 422.
  - A PDF from another trip returns 422 or 404, as the existing attribution check does.
  - The same id for photo and PDF returns 422.
  - v3 verifies end to end, and v2 and legacy loading receipts still verify.
  - Requests from other phases are unchanged.
  - The B3 snapshot gains the loading v3 case.
  - The audit pack includes the PDF.

## 7. Anchoring requirement (all stages)

Every driver-app phase must remain anchored to Hedera. As of 2026-10-15 it is:
`trip_creation`→`JOURNEY_LOCK`, `activation`→`ACTIVATION`, `loading`→`LOADING`,
`departure`→`PICKUP`, `in_transit`→`TRANSIT_ARRIVAL`, `arrival`→`ARRIVAL_INSPECTION`,
`unloading`→`UNLOADING`, `confirmation`→`DELIVERY`. A Hedera outage leaves the phase completed
but with its anchor marked failed, and `anchor_recovery.py` retries it.

- `test_anchored_phases_is_every_phase_type` and
  `test_every_phase_of_a_completed_trip_ends_anchored_with_matching_receipt_type` must stay green.
  Both pass on `dev` (9 passed, 2026-10-15).
- Extend the end-to-end test to assert that loading anchors v3 including `linehaul_pdf_sha256`,
  and that the departure and arrival payloads are byte-identical to before for the same inputs.
- Device smoke test: walk one trip end to end and confirm every phase shows as anchored in
  `AnchorProgress`.

## 8. Error handling summary

| Failure | Result |
|---------|--------|
| OCR plugin missing, throws, or times out | Driver types the number; `seal_number_source = typed` |
| OCR reads a wrong number | Driver corrects it; `ocr_corrected` is recorded |
| Scanner cancelled | Step stays unchanged; driver scans again |
| PDF build fails | Photo-only completion; `linehaul_pdf_sha256 = null` in v3 |
| Early upload fails | The existing submit-time upload from the draft data URL |
| Non-PDF cited as the PDF | 422 before anything is recorded |
| Hedera unavailable | Existing behaviour: phase completes, anchor marked failed, recovery retries |

## 9. POPIA

- OCR runs on the device; the seal photo is not sent anywhere new.
- The PDF holds the same linehaul sheet (no per-parcel data) and is stored in private evidence storage in `af-south-1`.
- Only SHA-256 hashes reach Hedera.

## 10. Verification commands

- Backend: `cd backend && TEST_DATABASE_URL="postgresql+asyncpg://timgultig@localhost:5433/freightproof_test" .venv/bin/pytest -q`
- Driver app (Node 22): `cd frontend/driver-pwa && npm run type-check && npm run lint && npm test && npm run build`
- Native: `npm run cap:sync` and `npm run cap:sync:ios`, then device runs for Stage A's checks, both seal paths and the linehaul scan.
