import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS of freightproof.co.za. Changing this does NOT rewrite the native
  // projects — ios/ and android/ were generated at `cap add` time and hold their own
  // copies (PRODUCT_BUNDLE_IDENTIFIER, applicationId/namespace, the Java package path).
  // All three must move together or the platforms ship under different identities.
  appId: "za.co.freightproof.driver",
  appName: "FreightProof Driver",
  // 'out' is the Next.js static export directory produced by `next build` with output: 'export'.
  webDir: "out",
  // NO server.iosScheme override — do not add one back. It is tempting, because Android's
  // androidScheme defaults to 'https' and giving iOS the same origin would collapse two
  // CORS entries and two Google Maps referrer entries into one. It does not work:
  // WKWebView reserves the schemes it handles natively, so
  // WKWebViewConfiguration.setURLSchemeHandler cannot be given 'https'
  // (@capacitor/cli declarations.d.ts on iosScheme says so outright). Capacitor registers
  // its asset handler against that scheme unvalidated, and the result is a WebView that
  // loads local assets but fails every outbound request with `TypeError: Load failed` —
  // an app that opens, accepts a login, and then cannot reach the API at all.
  //
  // So the two platforms deliberately have different origins, and both need listing:
  //   iOS      capacitor://localhost
  //   Android  https://localhost
  // in backend ALLOWED_ORIGINS. Google Maps cannot referrer-restrict capacitor://, so iOS
  // needs a key restricted by API + quota instead of by referrer (see .env.example).
  plugins: {
    Camera: {
      permissions: ["camera", "photos"],
    },
    Geolocation: {
      permissions: ["location"],
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
