/**
 * Local info notifications (J11) — currently exactly one: the optional
 * one-shot "Neue Box ‚<label>' erkannt" when a foreign box is auto-created
 * from a tag read (BUILD_V1 §9.2). Purely informational, never a dialog,
 * and NEVER blocking or failing the TAG_READ flow: every call here is
 * fire-and-forget and swallows all errors.
 *
 * Channel: own LOW-importance channel `timeserved_info` (silent, no heads-up)
 * — separate from the FGS session channel `timeserved_session` owned by
 * modules/fgs, so users can mute info notices while keeping the session one.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const INFO_CHANNEL_ID = 'timeserved_info';

let initialized = false;

/**
 * One-time setup, called from the composition root: foreground presentation
 * behavior (tag reads happen with the app foreground by construction —
 * CLAUDE.md §4 — so without a handler nothing would ever show) and the
 * Android channel. Never throws.
 */
export async function initInfoNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false, // LOW importance: list-only, no banner, no sound
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(INFO_CHANNEL_ID, {
        name: 'Hinweise',
        importance: Notifications.AndroidImportance.LOW,
        showBadge: false,
        enableVibrate: false,
        sound: null,
      });
    }
  } catch {
    // Notifications unavailable (e.g. test env) — notifyForeignBox no-ops too.
  }
}

/**
 * The §9.2 one-shot info notice. Skipped silently unless POST_NOTIFICATIONS is
 * granted; never throws (the caller is the TAG_READ path).
 */
export async function notifyForeignBoxCreated(label: string): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await initInfoNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Neue Box ‚${label}‘ erkannt`,
        body: 'Die Box wurde automatisch von ihrem Tag übernommen.',
        sound: false,
      },
      trigger:
        Platform.OS === 'android'
          ? { channelId: INFO_CHANNEL_ID }
          : null,
    });
  } catch {
    // Informational only — a failed notification must never surface.
  }
}
