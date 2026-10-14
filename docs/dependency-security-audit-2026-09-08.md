# Frontend production dependency audit — 2026-09-08

## Scope

This record covers `npm audit --omit=dev` for `frontend/dispatcher` and
`frontend/driver-pwa`. Development-only findings are outside this production-runtime
assessment and should be handled as a separate toolchain maintenance task.

## Remediation applied

- Raised both applications' Next.js minimum to 15.5.25. This fixes the reported
  Server Components denial of service, Server Action issues, middleware bypasses,
  cache poisoning, and server-side request forgery advisories affecting the earlier
  15.5.15 and 15.5.18 lockfile versions.
- Updated the resolved Sharp, NanoID, brace-expansion, PostCSS, and related packages
  to patched releases within the applications' existing major-version ranges.

## Remaining audit report

The dispatcher production audit retains two affected packages: `postcss` (high) and
its parent `next` (moderate). The driver audit retains those two plus `browserslist`
(high) and its parent `@serwist/next` (high), for four affected packages in total.
Next.js 15.5.25 pins PostCSS 8.4.31 internally, and npm offers only a Next.js 16 major
upgrade as its automated remediation. The actual driver lockfile resolves Serwist
9.5.11, which pins Browserslist 4.28.2 exactly.

The four PostCSS advisories are not reachable in either deployed application:

- The stringify XSS requires attacker-controlled CSS to be passed through PostCSS and
  embedded into an HTML style element.
- The three source-map file disclosure/path traversal advisories require
  attacker-controlled CSS comments to be processed with filesystem access.
- The Browserslist memory-growth advisory requires an attacker to drive unbounded
  distinct query evaluation in the build process. The custom-stats advisory requires
  attacker-controlled `browserslist-stats.json` input.

PostCSS runs while building trusted repository CSS. Neither application accepts CSS,
source maps, or PostCSS configuration from users, and neither invokes PostCSS in its
deployed request path. The driver is a static export; the dispatcher has a Next.js
server, but runtime requests do not compile CSS. Build workers must continue to build
only reviewed repository content and must not build untrusted pull requests with
production secrets present.

Browserslist is likewise invoked by Serwist during the driver build against repository
configuration. The application does not evaluate Browserslist queries or accept custom
browser statistics at runtime. We therefore retain Serwist's tested dependency choice
instead of overriding its exact pin and taking ownership of an untested combination.

The PostCSS exception should be removed when a compatible Next.js 15 patch adopts
PostCSS 8.5.23 or later, or during a separately tested Next.js 16 upgrade. The
Browserslist exception should be removed when Serwist publishes a compatible release
with a patched dependency. Re-run both production audits whenever either lockfile changes.
