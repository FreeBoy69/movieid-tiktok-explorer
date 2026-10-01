# AutoYT for iOS and Android

The apps are [Capacitor](https://capacitorjs.com) shells around the live web app at
https://autoyt.cc (`capacitor.config.ts`). They use the same server, database,
accounts and session as the website.

## How updates reach the apps

| You change… | What ships it | Store review? |
|---|---|---|
| Anything in `src/`, `server/`, `server.js` | push to `main` → **Deploy AutoYT to LingCode Cloud** | No. Both apps load the new build the next time they open. |
| `ios/`, `android/`, `mobile/`, `capacitor.config.ts` | push to `main` → **Build iOS and Android apps** (`.github/workflows/mobile.yml`) | Yes. A new TestFlight build and Google Play internal-testing release. |

Pushing to a `mobile/*` branch builds both apps without uploading them, which is
a safe way to try native changes. You can also start the workflow by hand from
the Actions tab.

## What is native

- **Sign-in and account connections.** Google, YouTube, TikTok and the social networks block OAuth
  inside app WebViews, so these flows run in the system browser and hand the
  session back through `autoyt://auth`, with a PKCE verifier only the app holds
  (`src/native/auth.ts`, `server/nativeApp.js`). On iOS this uses
  `ASWebAuthenticationSession`; on Android it uses Custom Tabs.
- **Sign in with Apple** on iOS (`ios/App/App/NativeAuthPlugin.swift`). App Review
  requires it whenever Google sign-in is offered.
- **In-app account deletion**: Account menu → Delete account (`POST /api/account/delete`).
- **Downloads.** Exports are saved through the share sheet: Save Video, Files, Drive, and so on.
- **Navigation.** A native tab bar (iOS tab bar / Material 3 navigation bar) on hub screens,
  Android Back closes sheets before going back, external links open in the in-app browser,
  plus haptics, safe areas, status-bar theming, a splash screen and an offline screen.
- **No purchases inside the apps.** Plans, credit packs, checkout and "buy" prompts are
  hidden, because both stores require their own billing for digital goods
  (`purchasesAllowed()` in `src/native/platform.ts`). Accounts with an active plan work normally.

## One-time setup

### Apple (TestFlight / App Store)

1. Create the app in [App Store Connect](https://appstoreconnect.apple.com) with bundle ID **`cc.autoyt.app`**.
2. Create an App Store Connect API key with the **Admin** role (Users and Access → Integrations).
   Admin lets CI create the signing certificate and the provisioning profile, and
   turn on the Sign in with Apple capability.
3. Add these to GitHub (Settings → Secrets and variables → Actions):
   - variable or secret `APPLE_TEAM_ID`: your 10-character Team ID
   - secret `APP_STORE_CONNECT_KEY_ID`
   - secret `APP_STORE_CONNECT_ISSUER_ID`
   - secret `APP_STORE_CONNECT_KEY_P8`: the full contents of the `.p8` file

### Google Play

1. Create an upload key once and keep it safe:
   `keytool -genkeypair -v -keystore autoyt-upload.jks -alias autoyt -keyalg RSA -keysize 2048 -validity 10000`
2. Add these GitHub secrets:
   - `ANDROID_KEYSTORE_BASE64`: the output of `base64 -i autoyt-upload.jks`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`autoyt`)
   - `ANDROID_KEY_PASSWORD`
3. Create the app in the [Play Console](https://play.google.com/console) with package **`cc.autoyt.app`**.
   Google requires the first release to be uploaded by hand. Download the `.aab`
   from the workflow run's artifacts and upload it to Internal testing.
4. Create a Google Cloud service account, grant it release access in Play Console (Users and permissions),
   and add its JSON key as the secret `PLAY_SERVICE_ACCOUNT_JSON`. Later releases then upload automatically.

Optional: set the repository variable `MOBILE_APP_VERSION` (default `1.0.0`). Build
numbers come from the workflow run number.

## Working locally

```sh
npx cap sync                                 # after changing plugins or capacitor.config.ts
npx cap open ios                             # Xcode (needs full Xcode, not Command Line Tools)
npx cap open android                         # Android Studio
node mobile/scripts/generate-assets.mjs      # re-render icons and splash screens
```

To point a build at another server, for example a local one: `AUTOYT_APP_URL=http://192.168.1.20:4183 npx cap sync`.

## Server settings

- `APPLE_BUNDLE_ID` (default `cc.autoyt.app`): the audience accepted for Sign in with Apple tokens.
  Use comma-separated `APPLE_BUNDLE_IDS` if more than one app signs in.
