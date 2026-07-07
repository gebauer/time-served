/**
 * Expo config plugin for the Time Served foreground service (BUILD_V1 §8.4).
 * Adds to the APP manifest:
 *  - permissions: FOREGROUND_SERVICE, FOREGROUND_SERVICE_CONNECTED_DEVICE,
 *    POST_NOTIFICATIONS (runtime-requested on 13+, J11's onboarding flow)
 *  - the <service> entry for TimeServedFgsService (type "connectedDevice";
 *    the `specialUse` fallback + Play justification is documented in
 *    modules/fgs/README.md).
 *
 * Deliberately NO <receiver> anywhere: power broadcasts are registered dynamically
 * inside the service (CLAUDE.md §4).
 *
 * Plain CommonJS on purpose — config plugins are require()'d by the Expo CLI.
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
} = require('expo/config-plugins');

const SERVICE_NAME = 'koeln.gebauer.timeserved.fgs.TimeServedFgsService';

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.POST_NOTIFICATIONS',
];

/** @param {import('expo/config').ExpoConfig} config */
function withTimeServedFgs(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);

  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    // Idempotent: drop any previous entry for our service, then (re-)add it.
    const services = (application.service ?? []).filter(
      (service) => service.$['android:name'] !== SERVICE_NAME,
    );
    services.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'false',
        'android:foregroundServiceType': 'connectedDevice',
      },
    });
    application.service = services;
    return mod;
  });

  return config;
}

module.exports = createRunOncePlugin(withTimeServedFgs, 'timeserved-fgs', '0.1.0');
