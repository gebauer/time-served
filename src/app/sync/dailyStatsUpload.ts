/**
 * The one direct collection write: sealed daily totals → `daily_stats`
 * (server/README.md "Sealed-daily-totals upload"). Composes the PB client and
 * device auth into the seal scheduler's `upload` dependency.
 *
 * Duplicate handling per the server contract: a 400 on the (user_id, date)
 * unique index means "already sealed on the server" → 'duplicate' so the
 * scheduler marks the local day sealed (idempotent recovery after a lost
 * response / restored device). We control the payload, so other validation
 * 400s cannot occur in practice; 401 is handled by deviceAuth's retry, and
 * network errors propagate for the retry-next-trigger policy.
 */
import type { DailyStat } from '../../domain/types';
import type { DeviceAuth } from './deviceAuth';
import { isPbError, type PocketBaseClient } from './pocketbaseClient';
import type { UploadOutcome } from './sealScheduler';

export function createDailyStatUploader(
  client: PocketBaseClient,
  auth: DeviceAuth,
): (stat: DailyStat) => Promise<UploadOutcome> {
  return async (stat) => {
    try {
      await auth.authed((token) =>
        client.createDailyStat(token, {
          user_id: stat.userId,
          date: stat.date,
          day_lock_sec: stat.dayLockSec,
          night_lock_sec: stat.nightLockSec,
          sealed_at: new Date(stat.sealedAt).toISOString(),
        }),
      );
      return 'created';
    } catch (error) {
      if (isPbError(error, 400)) return 'duplicate';
      throw error;
    }
  };
}
