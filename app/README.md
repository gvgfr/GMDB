# Masala Meter app (Capacitor wrapper)

This is a thin native wrapper around the live site (https://gvgfr.github.io/GMDB/),
built with [Capacitor](https://capacitorjs.com/). The app just opens the live site
in a native WebView (see `server.url` in `capacitor.config.json`) — there's no
separate app build/content to keep in sync. Any change pushed to the site shows
up in the app immediately, no app update needed.

## Android

A debug APK is built automatically by `.github/workflows/build-android.yml`
on every push to `app/**`, and can also be triggered manually from the
Actions tab ("Build Android App" → Run workflow). Download it from the
workflow run's Artifacts section and install it on an Android phone
(you'll need to allow "install from unknown sources" since it's unsigned).

To build locally instead (requires Android Studio / Android SDK + JDK 17+):

```
cd app
npm install
npx cap sync android
cd android
./gradlew assembleDebug      # unsigned debug APK
# or open the android/ folder in Android Studio and hit Run
```

A release build for the Play Store needs a signing key — see
https://developer.android.com/studio/publish/app-signing.

## iOS

Building and signing an iOS app requires Xcode on a Mac — this can't be done
from this environment. Here's the full path to an App Store submission.

### 1. One-time setup (do this first, takes longest)

- Install [Xcode](https://apps.apple.com/us/app/xcode/id497799835) from the
  Mac App Store, and open it once to accept the license + install components.
- Enroll in the [Apple Developer Program](https://developer.apple.com/programs/)
  ($99/year) using your Apple ID. This is required for TestFlight and the
  App Store (not needed just to run on your own device via Xcode).
- In [App Store Connect](https://appstoreconnect.apple.com), create a new
  app: My Apps → + → New App. Use bundle ID `com.masalameter.app` (matches
  `capacitor.config.json` — register it under Certificates, Identifiers &
  Profiles first if App Store Connect doesn't offer it automatically), name
  it "Masala Meter", pick a primary language and category (Entertainment).

### 2. Things only you can provide

- **App icon**: a single 1024×1024 PNG, no transparency, no rounded corners
  (Apple/Android both round it for you). There's no existing logo in this
  repo — drop one at `app/resources/icon.png`, then run:
  ```
  cd app
  npm install -D @capacitor/assets
  npx capacitor-assets generate --ios --android
  ```
  This generates every required icon size for both platforms from that one file.
- **Privacy Policy URL**: App Store Connect requires one. A draft is already
  live at `https://gvgfr.github.io/GMDB/privacy.html` — edit
  `privacy.html` at the repo root first to replace the placeholder contact
  email, then paste that URL into App Store Connect's "Privacy Policy URL" field.
- **Screenshots**: at least one set at 6.9" (e.g. iPhone 16 Pro Max)
  resolution — easiest way is Xcode's simulator (Cmd+S to screenshot) for
  a device of that size.
- **Content rating / age rating questionnaire**: fill out in App Store
  Connect under the app's "App Privacy" and "Age Rating" sections — for an
  app like this (no user-generated public content, no ads), most answers
  are "No".

### 3. Build and submit (in Xcode, on your Mac)

```
cd app
npm install
npx cap sync ios
npx cap open ios
```

That opens `ios/App/App.xcworkspace` in Xcode.
1. Select the "App" target → Signing & Capabilities → check "Automatically
   manage signing" → pick your Developer Program team.
2. Set the version/build number (Target → General) if this isn't the first submission.
3. Product → Destination → "Any iOS Device (arm64)".
4. Product → Archive. When it finishes, the Organizer window opens.
5. Click "Distribute App" → "App Store Connect" → follow the prompts to upload.
6. Back in App Store Connect, attach the uploaded build to your app version,
   fill in the remaining listing fields (description, keywords, screenshots),
   and hit "Submit for Review". Apple's review usually takes 1–3 days for a
   first submission.

To just run it on your own iPhone first (no Developer Program needed, good
for testing before you pay for enrollment): plug the phone into the Mac,
pick it as the destination in Xcode, hit Run (▶), then on the phone go to
Settings → General → VPN & Device Management and trust your developer
certificate once prompted.

## Changing app details

- App name / bundle ID: `capacitor.config.json` (`appName`, `appId`), plus
  `android/app/src/main/res/values/strings.xml` and the iOS Xcode project
  settings if you rename after the fact.
- App icon / splash screen: currently the Capacitor defaults. Use
  `@capacitor/assets` to generate real ones from a source image:
  `npx @capacitor/assets generate --android --ios` (needs a `resources/icon.png`
  and `resources/splash.png`).
