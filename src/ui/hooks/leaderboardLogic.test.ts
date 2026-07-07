import { describe, expect, it } from 'vitest';

import type { GroupId, NickOverride, UserId } from '../../domain/types';
import { applyNickOverrides } from './leaderboardLogic';

const GROUP = 'group-1' as GroupId;
const A = 'user-a' as UserId;
const B = 'user-b' as UserId;

describe('applyNickOverrides', () => {
  const members = [
    { userId: A, displayName: 'Mama' },
    { userId: B, displayName: 'Papa' },
  ];

  it('replaces the display name where an override exists', () => {
    const overrides: NickOverride[] = [
      { groupId: GROUP, memberUserId: A, localLabel: 'Petra' },
    ];
    expect(applyNickOverrides(members, overrides)).toEqual([
      { userId: A, displayName: 'Petra' },
      { userId: B, displayName: 'Papa' },
    ]);
  });

  it('ignores blank overrides', () => {
    const overrides: NickOverride[] = [
      { groupId: GROUP, memberUserId: A, localLabel: '   ' },
    ];
    expect(applyNickOverrides(members, overrides)[0].displayName).toBe('Mama');
  });

  it('is a no-op without overrides', () => {
    expect(applyNickOverrides(members, [])).toEqual(members);
  });
});
