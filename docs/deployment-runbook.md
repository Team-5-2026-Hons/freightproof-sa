# Deployment runbook — hosted and local

How FreightProof runs on real infrastructure, and how to keep running it entirely on
localhost afterwards. Written for the four of us, not for a marker.

Last verified against the live deployment on 2026-09-15.

---

## 1. What runs where

| Surface | Host | Origin | Deployed from |
|---|---|---|---|
| API (FastAPI) | Railway | `https://api.freightproof.co.za` | `backend/`, via `backend/Dockerfile` |
| Dispatcher | Vercel | `https://www.freightproof.co.za` | `frontend/dispatcher/` |
| Receiver | Vercel | `https://receiver.freightproof.co.za` | `frontend/receiver/` |
| Driver | Apple TestFlight | `capacitor://localhost` (in-app) | `frontend/driver-pwa/` static export in a Capacitor iOS shell |

`app.freightproof.co.za` currently resolves to Vercel but has no deployment behind it
(`DEPLOYMENT_NOT_FOUND`). Either point it at the receiver project or remove the DNS record —
a dangling subdomain on your own domain is worth cleaning up.

### The one constraint that dictates the subdomains

The handover binding cookie is set `SameSite=Strict; Secure`
(`backend/app/api/v1/endpoints/handover.py`). That means:

* The receiver app **must** be HTTPS. A plain-HTTP origin never receives the cookie.
* The receiver app **must** share a registrable domain with the API.
  `receiver.freightproof.co.za` and `api.freightproof.co.za` do. A `*.vercel.app` URL does
  **not**, and the browser simply declines to send the cookie back.

Either failure surfaces as the handover's deliberately generic 404 — the same response a
genuinely expired token produces, because the endpoint refuses to act as an oracle. There
is nothing in the logs distinguishing them. This is why `ENVIRONMENT=production` now
refuses to start when `HANDOVER_RECEIVER_BASE_URL` is loopback or plain HTTP
(`backend/app/core/config_validation.py`).

---

## 2. The QR and Didit chain, end to end

Worth reading once before changing any URL, because a single setting appears in three
places:

1. Driver reaches the confirmation phase. The app asks the API for a capability token.
2. API builds the QR URL: `build_scan_url()` →
   `{HANDOVER_RECEIVER_BASE_URL}/h/{token}`.
3. Receiver scans it with their own phone camera and lands on the receiver app. The
   `GET /api/v1/handover/{token}` that page makes is what **mints the binding cookie**.
4. Receiver consents to identity verification. The API creates a Didit session, handing
   Didit a `callback` of — again — `{HANDOVER_RECEIVER_BASE_URL}/h/{token}`.
5. Didit runs its hosted flow on its own domain, then returns the receiver to that
   callback.
6. The receiver's page polls for the decision. Independently, Didit POSTs the decision to
   `https://api.freightproof.co.za/api/v1/handover/webhooks/didit`, HMAC-signed.
7. Receiver signs, the app POSTs the confirmation **with the binding cookie**, and the
   delivery is recorded.

So `HANDOVER_RECEIVER_BASE_URL` is simultaneously the QR target, the Didit return address,
and (via `Settings.cors_allowed_origins`) a CORS entry. Set it once, correctly, and all
three follow. Set it wrong and all three break together.

---

## 3. Railway — API environment

Set these on the Railway service. Values marked **required** have no safe default and the
app will refuse to boot without them.

```bash
ENVIRONMENT=production
APP_VERSION=<git tag or short sha>          # so /health names the build actually serving

# CORS — browser origins ONLY.
# Do NOT list capacitor://localhost or https://localhost here; they are folded in
# automatically (Settings.cors_allowed_origins) precisely so no .env can drop them.
# Do NOT list the receiver origin either — it is folded in from the URL below.
ALLOWED_ORIGINS=["https://www.freightproof.co.za"]

# required — the QR target, the Didit callback, and a CORS entry, all at once.
HANDOVER_RECEIVER_BASE_URL=https://receiver.freightproof.co.za

# The client portal that serves audit-pack share links (/p/<token>) and seal checks
# (/v/<pack id>). Printed into every issued PDF and folded into CORS automatically.
AUDIT_PACK_PORTAL_BASE_URL=https://portal.freightproof.co.za

# required in production — an explicit statement about topology, not a default.
# true: Railway's edge overwrites X-Forwarded-For, so it is the real client address.
# Governs the rate-limit bucket key AND the receiver_ip evidence field on every handover.
RATE_LIMIT_TRUST_PROXY_HEADERS=true
RATE_LIMIT_ENABLED=true

# Didit, live
IDVS_USE_MOCK=false
IDVS_API_URL=https://verification.didit.me
IDVS_API_KEY=<from the Didit dashboard>
IDVS_WORKFLOW_ID=<the full KYC workflow: document + liveness + face match>
IDVS_WEBHOOK_SECRET=<from the Didit dashboard webhook config>

# Everything else — DATABASE_URL, REDIS_URL, SUPABASE_*, HEDERA_* — as per
# backend/.env.example. DATABASE_URL points at the same Supabase project (PostgreSQL 17.6,
# af-south-1).
```

**`DEV_PANEL_ENABLED`**: leave unset for a real deployment. The deployed demo genuinely
runs as `ENVIRONMENT=production` (to keep `/docs` unpublished) and the panel is gated on
this flag alone, so it *can* be switched on for a demo window — but it publishes endpoints
that fabricate evidence events. Turn it off when the demo closes.

### What happens if you get it wrong

The API now refuses to start and names every problem at once, rather than coming up green
and failing later at a handover nobody can debug. Railway's health check will show the
deploy as failed and the log line begins `Refusing to start:`. Rules and reasoning live in
`backend/app/core/config_validation.py`.

---

## 4. Vercel — receiver app (new project)

1. New Vercel project, root directory `frontend/receiver`.
2. Build command `npm run build`, framework preset Next.js. Leave the output directory to
   the preset — this app is **not** a static export (unlike driver-pwa), so its
   `next.config.js` `headers()` block is live and does real work.
3. Domain: `receiver.freightproof.co.za`. See §1 for why the subdomain is not optional.
4. Environment variable:

```bash
NEXT_PUBLIC_API_URL=https://api.freightproof.co.za
```

That is the app's only configuration. It holds no session and talks to exactly two
endpoints.

---

## 4a. Vercel — client portal (audit packs, new project)

The page an insurer, loss adjuster or detective opens from an audit-pack share link. It
verifies anchors against the public Hedera mirror node **from the visitor's own browser**.

1. New Vercel project, root directory `frontend/client-portal`, framework preset Next.js,
   Node 22. Not a static export: `next.config.js` `headers()` sets `Referrer-Policy:
   no-referrer` and `X-Frame-Options: DENY`, and both matter (the URL path is the credential).
2. Domain: `portal.freightproof.co.za` — must equal `AUDIT_PACK_PORTAL_BASE_URL` on Railway,
   or issued PDFs print a verification address nobody can open.
3. Environment variables:

```bash
NEXT_PUBLIC_API_URL=https://api.freightproof.co.za
# Optional — defaults to the public OpenStreetMap tiles, same as the dispatcher.
NEXT_PUBLIC_TILE_URL=
```

**Before the first pack is issued in production:**

- Apply migration `tim_add_audit_packs` (three new tables: `audit_packs`,
  `audit_pack_access_events`, `incident_declarations`) **from `dev` after merge** — never
  from a feature branch (CLAUDE.md).
- The API image needs Pango/HarfBuzz for WeasyPrint (already in `backend/Dockerfile`). Check
  the first Railway build log; if the PDF endpoints 500, this is the first suspect. The
  container build was not verified before merge (no Docker on the development machine).
- Issued PDFs are stored under `audit-packs/` in the existing `evidence-artifacts` bucket; no
  new bucket is needed.

---

## 5. Vercel — dispatcher (already deployed)

Already live at `https://www.freightproof.co.za` and already pointing at
`https://api.freightproof.co.za`. Nothing about this merge changes its configuration.
Confirm after deploying that `NEXT_PUBLIC_API_URL` is still the hosted API and that
`NEXT_PUBLIC_DEV_PANEL` is unset.

---

## 6. Driver app — TestFlight build

The driver app is a Next.js static export wrapped in a Capacitor iOS shell, so
`NEXT_PUBLIC_API_URL` is **baked into the bundle at build time**. There is no server to
read it at runtime and no way to change it after the fact short of a new build.

```bash
cd frontend/driver-pwa
NEXT_PUBLIC_API_URL=https://api.freightproof.co.za \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
npm run build
npx cap sync ios
npx cap open ios     # then Archive → Distribute → TestFlight
```

`next.config.ts` throws on a production build if `NEXT_PUBLIC_API_URL` is unset or contains
`localhost`, so a mis-targeted TestFlight build fails loudly at build time instead of
shipping an app that opens, accepts a login, and then cannot reach anything.

Two things that are already correct and should stay that way:

* **ATS.** `ios/App/App/Info.plist` sets only `NSAllowsLocalNetworking`. Since the hosted
  API is HTTPS, no ATS exception is needed — do not add one.
* **CORS.** The iOS shell's origin is `capacitor://localhost` and Android's is
  `https://localhost`. Both are folded into the allow-list by the API automatically. Do not
  add them to `ALLOWED_ORIGINS`; listing them there is what made them deletable before.

---

## 7. Didit dashboard

1. **Webhook URL**: `https://api.freightproof.co.za/api/v1/handover/webhooks/didit`
2. Copy the signing secret into Railway as `IDVS_WEBHOOK_SECRET`.
   Signature verification **fails closed** — an unset secret rejects every genuine
   delivery with a 401 logged as an invalid signature, which is indistinguishable from an
   attacker in the logs. This is why the app now refuses to boot in that state.
3. No callback URL needs registering: the API sends a per-session `callback` on each
   `POST /v3/session/`, built from `HANDOVER_RECEIVER_BASE_URL`.
4. **Quota.** The free tier is 500 sessions per calendar month and session 501 bills
   silently with no rate limit at the boundary. `IDVS_MONTHLY_SESSION_LIMIT` enforces the
   ceiling on our side — at the limit the handover degrades to a lower evidence tier; it
   never bills and never blocks a delivery.

---

## 8. Running it all on localhost

Nothing above removes local operation. The hosted setup is entirely environment
configuration — there are no production-only code paths.

**Plain local development** (everything on your own machine, no phone involved):

```bash
# backend/.env
ENVIRONMENT=development
HANDOVER_RECEIVER_BASE_URL=http://localhost:3002
IDVS_USE_MOCK=true
RATE_LIMIT_TRUST_PROXY_HEADERS=false
```

`ENVIRONMENT=development` switches off every production precondition, so loopback URLs and
mocked vendors are fine. `/docs` is served again too.

**Local with a real phone** (scanning a real QR against your laptop):

`localhost` on the receiver's phone means *the phone*, so the QR must carry your machine's
LAN address:

```bash
# backend/.env
HANDOVER_RECEIVER_BASE_URL=http://192.168.x.x:3002    # `ipconfig getifaddr en0`

# frontend/receiver/.env.local
NEXT_PUBLIC_API_URL=http://192.168.x.x:8000
```

Both must name the same address. The API folds the receiver origin into CORS
automatically, so there is nothing else to keep in sync. This changes whenever you join a
different network — if handovers start failing instantly after a network switch, check
this first.

**Local with live Didit**: set `IDVS_USE_MOCK=false` plus the four `IDVS_*` values. The
webhook will not reach your laptop (Didit cannot call a LAN address), so verification falls
back to the receiver page's own polling — which is the designed behaviour, the webhook
being a backstop rather than the primary path. Use a tunnel (ngrok/cloudflared) only if you
specifically need to exercise the webhook.

---

## 9. Verifying a deployment

```bash
# 1. The API is up and naming the build you think it is.
curl -s https://api.freightproof.co.za/health
# {"status":"ok","environment":"production","version":"<your APP_VERSION>"}

# 2. The handover routes exist. A junk token must give 404 (not 405, which would mean
#    the router is missing entirely — that is what the pre-merge deployment returned).
curl -s -o /dev/null -w "%{http_code}\n" https://api.freightproof.co.za/api/v1/handover/xyz

# 3. CORS accepts the receiver origin.
curl -s -D - -o /dev/null -X OPTIONS \
  https://api.freightproof.co.za/api/v1/handover/xyz \
  -H "Origin: https://receiver.freightproof.co.za" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin

# 4. The webhook rejects an unsigned body (proves the secret is set and failing closed).
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://api.freightproof.co.za/api/v1/handover/webhooks/didit \
  -H "Content-Type: application/json" -d '{}'
# expect 401

# 5. /docs must NOT be published in production.
curl -s -o /dev/null -w "%{http_code}\n" https://api.freightproof.co.za/docs
# expect 404
```

Then walk one real handover end to end: driver reaches confirmation, second phone scans the
QR, identity check runs, receiver signs, dispatcher sees the confirmation. That exercises
every link in §2 and is the only check that proves the cookie, the CORS entry and the Didit
callback all agree.

---

## 10. Known gaps

* **Driver app has no browser deployment.** Only the TestFlight iOS build exists. If a
  browser PWA is ever hosted, its security headers must be set at the hosting layer —
  `output: 'export'` means `next.config.ts`'s `headers()` does nothing (the file says so
  itself).
* **`app.freightproof.co.za` is a dangling DNS record.** Point it somewhere or remove it.
* **Android is untested against the hosted API.** `https://localhost` is in the allow-list
  and the code path is identical to iOS, but no Android build has been run against
  production.
