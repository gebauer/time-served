/**
 * useSessionState — subscribes to the engine's machine state (IDLE/ARMED/ACTIVE).
 */
import { useEffect, useState } from 'react';

import type { SessionState } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';

export function useSessionState(): SessionState {
  const { engine } = useAppServices();
  const [state, setState] = useState<SessionState>(() => engine.getState());
  useEffect(() => {
    setState(engine.getState()); // catch changes between render and subscribe
    return engine.subscribe(setState);
  }, [engine]);
  return state;
}
