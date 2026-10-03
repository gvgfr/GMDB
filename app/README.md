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
from this environment. On a Mac, with Xcode and CocoaPods installed:

```
cd app
npm install
npx cap sync ios
npx cap open ios
```

That opens `ios/App/App.xcworkspace` in Xcode. Pick a signing team under
Signing & Capabilities, then Run on a simulator/device, or Archive to submit
to TestFlight / the App Store.

## Changing app details

- App name / bundle ID: `capacitor.config.json` (`appName`, `appId`), plus
  `android/app/src/main/res/values/strings.xml` and the iOS Xcode project
  settings if you rename after the fact.
- App icon / splash screen: currently the Capacitor defaults. Use
  `@capacitor/assets` to generate real ones from a source image:
  `npx @capacitor/assets generate --android --ios` (needs a `resources/icon.png`
  and `resources/splash.png`).
