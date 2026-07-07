/**
 * useAsyncData — small query helper: runs an async fetcher, re-runs when the
 * app-wide ChangeNotifier fires or when the screen regains focus (tab screens
 * stay mounted). No caching library; the data sets here are tiny and local.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import { useAppServices } from '../services/AppServicesContext';

export interface AsyncData<T> {
  readonly data: T | undefined;
  readonly reload: () => void;
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): AsyncData<T> {
  const { events } = useAppServices();
  const isFocused = useIsFocused();
  const [data, setData] = useState<T | undefined>(undefined);
  // Keep the latest fetcher without making it a dependency (callers pass
  // inline closures; `deps` is the identity that matters).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let cancelled = false;
    void fetcherRef.current().then(
      (result) => {
        if (!cancelled) setData(result);
      },
      () => {
        // Dev/mock wiring: surface nothing rather than crash the screen.
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's identity list
  }, [generation, isFocused, ...deps]);

  useEffect(() => events.subscribe(reload), [events, reload]);

  return { data, reload };
}
