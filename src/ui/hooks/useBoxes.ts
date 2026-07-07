/**
 * useBoxes — box list + own-box mutations (foreign boxes are read-only,
 * BUILD_V1 §9.2). Creation happens in the register wizard (useBoxWizard).
 */
import { useCallback } from 'react';

import type { Box, BoxId } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';
import { useAsyncData } from './useAsyncData';

export interface Boxes {
  readonly boxes: readonly Box[] | undefined;
  updateBox(id: BoxId, patch: { label?: string; location?: string }): Promise<void>;
  deleteBox(id: BoxId): Promise<void>;
}

export function useBoxes(): Boxes {
  const { repositories, events } = useAppServices();
  const { data } = useAsyncData(() => repositories.boxes.list(), []);

  const updateBox = useCallback(
    async (id: BoxId, patch: { label?: string; location?: string }) => {
      await repositories.boxes.update(id, patch);
      events.notify();
    },
    [repositories, events],
  );

  const deleteBox = useCallback(
    async (id: BoxId) => {
      await repositories.boxes.softDelete(id);
      events.notify();
    },
    [repositories, events],
  );

  return { boxes: data, updateBox, deleteBox };
}
