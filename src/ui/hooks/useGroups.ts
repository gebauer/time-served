/**
 * useGroups — group list + create/join/leave over the GroupsGateway seam
 * (stubbed in-memory until J10 wires PocketBase + real crypto).
 */
import { useCallback } from 'react';

import type { GroupId } from '../../domain/types';
import {
  useAppServices,
  type GroupSummary,
} from '../services/AppServicesContext';
import { useAsyncData } from './useAsyncData';

export interface Groups {
  readonly groups: readonly GroupSummary[] | undefined;
  create(name: string, nickname: string): Promise<{ group: GroupSummary; inviteLink: string }>;
  join(inviteUrl: string, nickname: string, consent: boolean): Promise<GroupSummary>;
  leave(groupId: GroupId): Promise<void>;
  parseInvite(url: string): { groupId: GroupId } | undefined;
  inviteLink(groupId: GroupId): Promise<string | undefined>;
  setNickname(groupId: GroupId, nickname: string): Promise<void>;
}

export function useGroups(): Groups {
  const { groups: gateway, events } = useAppServices();
  const { data } = useAsyncData(() => gateway.list(), []);

  const create = useCallback(
    async (name: string, nickname: string) => {
      const result = await gateway.create(name, nickname);
      events.notify();
      return result;
    },
    [gateway, events],
  );

  const join = useCallback(
    async (inviteUrl: string, nickname: string, consent: boolean) => {
      const group = await gateway.join(inviteUrl, nickname, consent);
      events.notify();
      return group;
    },
    [gateway, events],
  );

  const leave = useCallback(
    async (groupId: GroupId) => {
      await gateway.leave(groupId);
      events.notify();
    },
    [gateway, events],
  );

  const setNickname = useCallback(
    async (groupId: GroupId, nickname: string) => {
      await gateway.setNickname(groupId, nickname);
      events.notify();
    },
    [gateway, events],
  );

  return {
    groups: data,
    create,
    join,
    leave,
    parseInvite: (url) => gateway.parseInvite(url),
    inviteLink: (groupId) => gateway.inviteLink(groupId),
    setNickname,
  };
}
