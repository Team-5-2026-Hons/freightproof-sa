import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS of freightproof.co.za. Changing this does NOT rewrite the native
  // projects — ios/ and android/ hold their own copies and all three must move together.
  appId: "za.co.freightproof.driver",
  appName: "FreightProof Driver",
  // Next.js static export directory produced by `next build` with output: 'export'.
  webDir: "out",
  // NO server.iosScheme override — do not add one back. WKWebView reserves 'https' and
  // can't be given it via setURLSchemeHandler, so aligning it with Android's default
  // produces a WebView that loads assets but fails every outbound request. The two
  // platforms deliberately have different origins (iOS capacitor://localhost, Android
  // https://localhost) — both must be listed in backend ALLOWED_ORIGINS, and iOS needs a
  // Google Maps key restricted by API + quota instead of by referrer.
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
