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
  server: {
    // iOS defaults to serving the bundled assets from `capacitor://localhost`. Two things
    // break on that origin, and both fail silently rather than erroring:
    //
    //   * Google Maps — the JS API's referrer allow-list accepts only http and https
    //     schemes, so a capacitor:// origin can never be allow-listed and the in-transit
    //     map renders blank while every other screen works.
    //   * CORS — the backend's ALLOWED_ORIGINS would need a second entry carrying a
    //     non-standard scheme, separate from the one Android already needs.
    //
    // 'https' makes the iOS origin `https://localhost`, which is exactly what Capacitor's
    // default androidScheme already produces. One referrer entry and one CORS entry now
    // cover both platforms. Changing this after release would orphan anything the WebView
    // stored under the old origin (localStorage, IndexedDB) — safe here because no build
    // has shipped yet.
    iosScheme: "https",
  },
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
