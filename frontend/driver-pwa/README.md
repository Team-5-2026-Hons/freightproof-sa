# driver-pwa

Driver-facing mobile app for FreightProof SA. Drivers use this to complete the five handshake steps — gate arrival acknowledgement, evidence capture, seal entry, waybill photo, and POD capture.

**Stack:** Next.js 15 App Router · TypeScript 5.5 · Tailwind v3.4 · Capacitor 6 (Android APK) · @serwist/next (browser PWA / offline)

**Output:** `output: 'export'` in `next.config.ts` — produces a static `out/` directory that Capacitor bundles into the Android APK. All pages are `"use client"` because Server Components are incompatible with static export.

**Native plugins:** `@capacitor/camera` · `@capacitor/geolocation` · `@capacitor/push-notifications` · `@capacitor-community/background-geolocation`

## Dev

```bash
npm install
npm run dev          # http://localhost:3001
```

Token preview (dev only): http://localhost:3001/dev/tokens

## Android build

```bash
npm run build        # produces out/
npx cap sync android # copies out/ into the Android project
npx cap open android # opens Android Studio — run on emulator or device from there
```

The `android/` directory is committed to git. Teammates clone and open it directly in Android Studio.

## Auth

JWT (same issuer as dispatcher backend). Drivers authenticate once per shift. On the driver-pwa, `AuthContext` uses a mock sign-in during v1 (no backend yet).
