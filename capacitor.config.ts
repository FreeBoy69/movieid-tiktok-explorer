import type { CapacitorConfig } from "@capacitor/cli";

// The native apps load the live web app, so every push to main that deploys
// autoyt.cc also updates the iOS and Android apps: same backend, same database,
// same session. Only changes to the native shell itself (plugins, icons, this
// file, ios/ or android/) need a new store build, which mobile.yml produces.
const appUrl = (process.env.AUTOYT_APP_URL || "https://autoyt.cc").replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "cc.autoyt.app",
  appName: "AutoYT",
  // Only the offline page ships inside the app; everything else comes from appUrl.
  webDir: "mobile/shell",
  backgroundColor: "#0f1113",
  // Lets the server and web app recognise the native shell (see src/native/platform.ts).
  appendUserAgent: "AutoYTApp/1",
  server: {
    url: appUrl,
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
    backgroundColor: "#0f1113",
  },
  android: {
    backgroundColor: "#0f1113",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#0f1113",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
      initialViewportFitValueHint: "cover",
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
