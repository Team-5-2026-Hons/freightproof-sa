import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.ac.uct.freightproof.driver",
  appName: "FreightProof Driver",
  // 'out' is the Next.js static export directory produced by `next build` with output: 'export'.
  webDir: "out",
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
