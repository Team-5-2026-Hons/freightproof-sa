import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.freightproof.driver",
  appName: "FreightProof Driver",
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
