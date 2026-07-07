/**
 * NFC availability status (J11 hardening) — a finer-grained view than the
 * boolean `TagReader.isAvailable()`: the Home banner needs to distinguish
 * "switched off" (offer the NFC settings) from "hardware missing" (inform,
 * degrade gracefully — history/groups keep working, BUILD_V1 §8.1).
 *
 * Pure status/navigation helpers on react-native-nfc-manager; deliberately NOT
 * part of the TagReader contract (additive, Android-only concern — the iOS
 * adapter later maps NFCTagReaderSession availability the same way).
 */
import NfcManager from 'react-native-nfc-manager';

export type NfcStatus = 'ok' | 'disabled' | 'unsupported';

/** Never throws — any native failure reads as 'unsupported'. */
export async function getNfcStatus(): Promise<NfcStatus> {
  try {
    if (!(await NfcManager.isSupported())) return 'unsupported';
    return (await NfcManager.isEnabled()) ? 'ok' : 'disabled';
  } catch {
    return 'unsupported';
  }
}

/** Open the system NFC settings screen (Android). Never throws. */
export async function openNfcSettings(): Promise<void> {
  try {
    await NfcManager.goToNfcSetting();
  } catch {
    // Settings screen unavailable on this OEM build — nothing else to do.
  }
}
