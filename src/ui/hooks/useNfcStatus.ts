/**
 * useNfcStatus (J11) — NFC availability for the Home banner. Rechecks on every
 * return to 'active' (the user may have toggled NFC in the system settings we
 * sent them to); when NFC comes back the passive tag reader — whose bootstrap
 * start failed while NFC was off — is restarted via the system seam. Devices
 * without NFC read 'unsupported' once and stay there: history/groups keep
 * working, only tag-driven sessions are off the table (BUILD_V1 §8.1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  useAppServices,
  type NfcAvailability,
} from '../services/AppServicesContext';

export interface NfcStatusInfo {
  /** undefined while the first check runs (render nothing then). */
  readonly status: NfcAvailability | undefined;
  openNfcSettings(): void;
}

export function useNfcStatus(): NfcStatusInfo {
  const { system } = useAppServices();
  const [status, setStatus] = useState<NfcAvailability | undefined>(undefined);
  const lastRef = useRef<NfcAvailability | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      const next = await system.nfcStatus();
      if (cancelled) return;
      // NFC came (back) on → the reader's bootstrap start likely failed while
      // NFC was off; restart it so scans work without an app restart.
      if (next === 'ok' && lastRef.current !== 'ok') {
        void system.restartTagReader();
      }
      lastRef.current = next;
      setStatus(next);
    };

    void check();
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') void check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [system]);

  const openNfcSettings = useCallback(() => void system.openNfcSettings(), [system]);

  return { status, openNfcSettings };
}
