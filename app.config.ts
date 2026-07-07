import type { ExpoConfig } from 'expo/config';

/**
 * Time Served — app config.
 *
 * The app name and the deep-link scheme live here (see CLAUDE.md preamble).
 * Grep for `timeserved` / `Time Served` before renaming anything.
 */
const config: ExpoConfig = {
  name: 'Time Served',
  slug: 'time-served',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  // Deep-link scheme: invite links + NFC tag URIs (`timeserved://box/<uuid>?v=1`).
  scheme: 'timeserved',
  android: {
    package: 'koeln.gebauer.timeserved',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // J10: https invite links (`https://timeserved.app/j#…`) offer the app in
    // the Android chooser. Unverified (no assetlinks.json yet — J11 hardening
    // can add autoVerify); the timeserved:// scheme works regardless.
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'timeserved.app', pathPrefix: '/j' }],
      },
    ],
  },
  ios: {
    // iOS is a later adapter swap (BUILD_V1 §13); config kept minimal but valid.
    supportsTablet: false,
  },
  plugins: [
    './plugins/nfc',
    './plugins/fgs',
  ],
};

export default config;
