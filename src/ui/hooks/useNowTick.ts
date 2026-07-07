/**
 * useNowTick — the injected clock's `now()`, re-read on a light interval ONLY
 * while the screen is focused (navigation focus gates the interval). This is a
 * DISPLAY tick: nothing is measured by it — durations always derive from
 * persisted timestamps (CLAUDE.md §3/§10 "no ticking timer to measure sessions").
 */
import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import type { EpochMs } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';

export function useNowTick(enabled: boolean, intervalMs = 1000): EpochMs {
  const { clock } = useAppServices();
  const isFocused = useIsFocused();
  const [now, setNow] = useState<EpochMs>(() => clock.now());

  useEffect(() => {
    if (!enabled || !isFocused) return;
    setNow(clock.now());
    const handle = setInterval(() => setNow(clock.now()), intervalMs);
    return () => clearInterval(handle);
  }, [enabled, isFocused, intervalMs, clock]);

  return now;
}
