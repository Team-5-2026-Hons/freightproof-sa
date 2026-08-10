# FreightProof driver application

The driver application guides a driver through the current row of a trip's committed phase plan. It captures evidence, supports offline submission, records trip location, and packages the static Next.js export for Android and iOS through Capacitor.

## Stack

- Next.js 15 App Router and React 19
- TypeScript and Tailwind CSS
- Capacitor 6 with camera, geolocation, and push-notification plugins
- Serwist service worker and offline queue
- Supabase Auth for real phone authentication

`output: "export"` in `next.config.ts` produces the static `out/` directory consumed by Capacitor. Driver pages are client components because the packaged application has no Next.js server at runtime.

## Configure

```bash
cp .env.example .env.local
```

Important variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | FastAPI origin. `localhost` is valid for browser development but rejected by production builds. |
| `NEXT_PUBLIC_DEMO_MODE` | `true` or unset uses mock login; `false` enables Supabase authentication. |
| `NEXT_PUBLIC_SUPABASE_URL` | Required for real authentication. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required for real authentication. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional; without it the map falls back to a coordinates card. |

Demo mode is for development and presentations. It is not a production authentication configuration.

## Develop

```bash
npm ci
npm run dev
```

The application runs at <http://localhost:3001>. The token-preview route is development-only: <http://localhost:3001/dev/tokens>.

## Validate

```bash
npm run lint
npm run type-check
npm test
NEXT_PUBLIC_API_URL=https://api.example.invalid npm run build
```

The build-time API value above is safe only for validation. Use the deployed backend origin for a package that will be installed on a device.

## Android

```bash
NEXT_PUBLIC_API_URL=https://your-api.example npm run build
npx cap sync android
npx cap open android
```

The `android/` project is committed. Android Studio, Java 17, and an appropriate Android SDK are required for native builds.

## iOS

```bash
NEXT_PUBLIC_API_URL=https://your-api.example npm run build
npx cap sync ios
npx cap open ios
```

Xcode and CocoaPods are required. Before distributing through TestFlight or the App Store, confirm that App Transport Security does not permit arbitrary loads, permission descriptions match the current evidence flow, release signing is configured, and the application has been tested on a physical device.

## Authentication modes

- **Demo mode:** `AuthContext` supplies the mock login and OTP flow. This is the current default when `NEXT_PUBLIC_DEMO_MODE` is missing.
- **Real mode:** Supabase handles the phone OTP session. The backend validates the Supabase JWT and resolves the driver role and device session.

Do not infer authentication mode from the build type. Set `NEXT_PUBLIC_DEMO_MODE` explicitly for every packaged build.

## Current lifecycle

The application reads the plan returned by the backend and completes a specific phase-event ID. A common two-stop trip contains:

`trip_creation → activation → loading → departure → in_transit → unloading → confirmation`

Phase types can recur in multi-stop plans, so application logic must not treat a phase type or sequence number as a globally unique identifier.
