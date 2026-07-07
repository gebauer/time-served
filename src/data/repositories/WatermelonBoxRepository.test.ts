import { beforeEach, describe, expect, it } from 'vitest';

import type { BoxId, Clock } from '../../domain/types';
import type { Repositories } from '../Repositories';
import { InMemorySecureStore } from '../secure';
import { createTestDatabase } from '../testing';
import { createRepositories } from './index';

const OWN = '11111111-1111-4111-8111-111111111111' as BoxId;
const FOREIGN = '22222222-2222-4222-8222-222222222222' as BoxId;

let fakeNow = 1_750_000_000_000;
const clock: Clock = { now: () => fakeNow };

let repos: Repositories;

beforeEach(async () => {
  fakeNow = 1_750_000_000_000;
  repos = createRepositories({
    database: createTestDatabase(),
    secureStore: new InMemorySecureStore(),
    clock,
  });
  await repos.boxes.create({
    id: OWN,
    label: 'Wohnzimmer',
    location: 'Sideboard',
    countMode: 'charging',
    origin: 'own',
  });
  await repos.boxes.create({
    id: FOREIGN,
    label: 'Papas Box',
    countMode: 'charging',
    origin: 'foreign',
  });
});

describe('BoxRepository', () => {
  it('round-trips create/get with all fields mapped', async () => {
    const box = await repos.boxes.get(OWN);
    expect(box).toMatchObject({
      id: OWN,
      label: 'Wohnzimmer',
      location: 'Sideboard',
      countMode: 'charging',
      origin: 'own',
      createdAt: fakeNow,
      updatedAt: fakeNow,
    });
    expect(box?.deletedAt).toBeUndefined();
    const foreign = await repos.boxes.get(FOREIGN);
    expect(foreign?.location).toBeUndefined();
  });

  it('updates own boxes (label + clearing location)', async () => {
    fakeNow += 1000;
    await repos.boxes.update(OWN, { label: 'Küche', location: undefined });
    const box = await repos.boxes.get(OWN);
    expect(box).toMatchObject({ label: 'Küche', updatedAt: fakeNow });
    expect(box?.location).toBeUndefined();
  });

  it('rejects update of foreign boxes (read-only, BUILD_V1 §9.2)', async () => {
    await expect(repos.boxes.update(FOREIGN, { label: 'Meins jetzt' })).rejects.toThrow(
      /foreign.*read-only/
    );
    // and the row is unchanged
    expect((await repos.boxes.get(FOREIGN))?.label).toBe('Papas Box');
  });

  it('softDelete hides the box from list() but keeps the row', async () => {
    fakeNow += 1000;
    await repos.boxes.softDelete(OWN);
    const listed = await repos.boxes.list();
    expect(listed.map((b) => b.id)).toEqual([FOREIGN]);
    // still resolvable for existing sessions' box_id
    const deleted = await repos.boxes.get(OWN);
    expect(deleted?.deletedAt).toBe(fakeNow);
  });

  it('softDelete is idempotent (keeps the first deleted_at)', async () => {
    fakeNow += 1000;
    await repos.boxes.softDelete(OWN);
    const firstDeletedAt = (await repos.boxes.get(OWN))?.deletedAt;
    fakeNow += 1000;
    await repos.boxes.softDelete(OWN);
    expect((await repos.boxes.get(OWN))?.deletedAt).toBe(firstDeletedAt);
  });
});
