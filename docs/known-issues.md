# Known issues and release risks

This file lists unresolved issues in the current implementation. Remove an entry when it is fixed, and record enduring product limitations in the repository README.

## 1. Driver production builds do not reject demo authentication

`frontend/driver-pwa/lib/constants/env.ts` treats a missing `NEXT_PUBLIC_DEMO_MODE` value as demo mode. The build validates the API URL but does not reject demo authentication or missing Supabase values.

**Impact:** a packaged application can accidentally ship with mock login and OTP behaviour.

**Required resolution:** introduce explicit demo and release build profiles. A release build must fail when demo mode is enabled or real authentication settings are absent.

## 2. Dependency audit findings require triage

The 2026-08-10 submission audit reported known vulnerabilities in the backend environment and both frontend dependency trees. Direct findings included Next.js, PostCSS, Vitest tooling, Capacitor CLI, `python-jose`, and `python-multipart`.

**Impact:** security and reproducibility risk; some fixes may require incompatible major-version upgrades.

**Required resolution:** classify direct versus transitive and runtime versus development findings, apply compatible patches first, run all affected checks, and document accepted risks. Do not apply forced major upgrades without an isolated branch and regression testing.

## 3. Trip creation cannot map consignments to intermediate stops

The phase-plan generator supports repeated per-stop work, but `TripConsignmentInput` does not include pickup and delivery stop references. `trip_service.create_trip` consequently assigns every new consignment to the first and final stops.

**Impact:** a newly created cross-dock trip cannot yet express that one consignment ends at an intermediate stop while another begins there.

**Required resolution:** extend the request schema, dispatcher workflow, validation, and integration tests. Until then, describe multi-stop support as representational rather than complete end-to-end consignment mapping.

## 4. Live warehouse scan feed is not implemented

`SCAN_FEED_USE_MOCK=false` raises `NotImplementedError` because no live WMS or depot scan source is available.

**Impact:** loading and reconciliation demonstrations depend on the Redis-backed mock feed.

**Required resolution:** obtain and implement a supported partner feed, or keep the limitation explicit in the submitted scope and demo narrative.
