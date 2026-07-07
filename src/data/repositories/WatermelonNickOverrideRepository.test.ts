import { beforeEach, describe, expect, it } from 'vitest';

import type { GroupId, UserId } from '../../domain/types';
import type { Repositories } from '../Repositories';
import { InMemorySecureStore } from '../secure';
import { createTestDatabase } from '../testing';
import { createRepositories } from './index';

const GROUP_A = 'aaaaaaaa-1111-4111-8111-111111111111' as GroupId;
const GROUP_B = 'bbbbbbbb-2222-4222-8222-222222222222' as GroupId;
const PETRA = 'cccccccc-3333-4333-8333-333333333333' as UserId;
const HANS = 'dddddddd-4444-4444-8444-444444444444' as UserId;

let repos: Repositories;

beforeEach(() => {
  repos = createRepositories({
    database: createTestDatabase(),
    secureStore: new InMemorySecureStore(),
  });
});

describe('NickOverrideRepository', () => {
  it('upserts and lists per group', async () => {
    await repos.nickOverrides.upsert({ groupId: GROUP_A, memberUserId: PETRA, localLabel: 'Petra' });
    await repos.nickOverrides.upsert({ groupId: GROUP_A, memberUserId: HANS, localLabel: 'Hans' });
    await repos.nickOverrides.upsert({ groupId: GROUP_B, memberUserId: PETRA, localLabel: 'Mama' });

    const forA = await repos.nickOverrides.listForGroup(GROUP_A);
    expect(forA.map((o) => o.localLabel).sort()).toEqual(['Hans', 'Petra']);
    const forB = await repos.nickOverrides.listForGroup(GROUP_B);
    expect(forB).toEqual([{ groupId: GROUP_B, memberUserId: PETRA, localLabel: 'Mama' }]);
  });

  it('upsert on the same (group, member) pair replaces instead of duplicating', async () => {
    await repos.nickOverrides.upsert({ groupId: GROUP_A, memberUserId: PETRA, localLabel: 'Petra' });
    await repos.nickOverrides.upsert({ groupId: GROUP_A, memberUserId: PETRA, localLabel: 'Oma' });
    const overrides = await repos.nickOverrides.listForGroup(GROUP_A);
    expect(overrides).toEqual([{ groupId: GROUP_A, memberUserId: PETRA, localLabel: 'Oma' }]);
  });

  it('delete removes exactly the pair and is a no-op when missing', async () => {
    await repos.nickOverrides.upsert({ groupId: GROUP_A, memberUserId: PETRA, localLabel: 'Petra' });
    await repos.nickOverrides.upsert({ groupId: GROUP_B, memberUserId: PETRA, localLabel: 'Mama' });
    await repos.nickOverrides.delete(GROUP_A, PETRA);
    expect(await repos.nickOverrides.listForGroup(GROUP_A)).toEqual([]);
    expect(await repos.nickOverrides.listForGroup(GROUP_B)).toHaveLength(1);
    // missing pair: resolves without throwing
    await expect(repos.nickOverrides.delete(GROUP_A, PETRA)).resolves.toBeUndefined();
  });
});
