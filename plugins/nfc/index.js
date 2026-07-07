/**
 * Expo config plugin: NFC for Time Served (J4; BUILD_V1 §8.1/§8.4).
 *
 * Adds to the Android manifest at prebuild time:
 *  - `android.permission.NFC`;
 *  - `<uses-feature android:name="android.hardware.nfc" android:required="false"/>`
 *    — NOT required, so phones without NFC can still install the app and view
 *    history/leaderboard;
 *  - an NDEF_DISCOVERED intent filter for scheme `timeserved` host `box` on the
 *    main activity, so scanning a box tag on an unlocked phone foregrounds the
 *    app (the passive-placement path). NFC still only dispatches with the
 *    screen on and unlocked — hard platform fact, CLAUDE.md §4.
 *
 * FGS bits live in `plugins/fgs` (J5); this plugin is NFC only.
 */
const { AndroidConfig, createRunOncePlugin, withAndroidManifest } = require('expo/config-plugins');

const NFC_PERMISSION = 'android.permission.NFC';
const NFC_FEATURE = 'android.hardware.nfc';
const NDEF_ACTION = 'android.nfc.action.NDEF_DISCOVERED';
const SCHEME = 'timeserved';
const HOST = 'box';

/** Add <uses-feature android:name="android.hardware.nfc" android:required="false"/>. */
function ensureNfcFeature(manifest) {
  if (!Array.isArray(manifest.manifest['uses-feature'])) {
    manifest.manifest['uses-feature'] = [];
  }
  const features = manifest.manifest['uses-feature'];
  const existing = features.find((f) => f.$ && f.$['android:name'] === NFC_FEATURE);
  if (existing) {
    existing.$['android:required'] = 'false';
  } else {
    features.push({ $: { 'android:name': NFC_FEATURE, 'android:required': 'false' } });
  }
}

/** Add the NDEF intent filter for timeserved://box/<uuid> to the main activity. */
function ensureNdefIntentFilter(manifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  if (!Array.isArray(mainActivity['intent-filter'])) {
    mainActivity['intent-filter'] = [];
  }
  const filters = mainActivity['intent-filter'];
  const alreadyThere = filters.some(
    (filter) =>
      Array.isArray(filter.action) &&
      filter.action.some((a) => a.$ && a.$['android:name'] === NDEF_ACTION)
  );
  if (alreadyThere) return;
  filters.push({
    action: [{ $: { 'android:name': NDEF_ACTION } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:scheme': SCHEME, 'android:host': HOST } }],
  });
}

const withTimeServedNfc = (config) => {
  config = AndroidConfig.Permissions.withPermissions(config, [NFC_PERMISSION]);
  config = withAndroidManifest(config, (config) => {
    ensureNfcFeature(config.modResults);
    ensureNdefIntentFilter(config.modResults);
    return config;
  });
  return config;
};

module.exports = createRunOncePlugin(withTimeServedNfc, 'time-served-nfc', '1.0.0');
