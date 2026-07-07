/**
 * Scriptable PowerStateProvider for the emulator/dev harness and tests (JOBS.md J5).
 * Pure TS, plain Node — no native imports.
 *
 * Unlike AndroidPowerStateProvider this fake does NOT normalize: tests script the
 * exact stream they want to assert against (including pathological duplicates, to
 * exercise consumers). isCharging() reflects the last simulated start/stop.
 */
import type { EpochMs } from '../../domain/types';
import type { PowerEvent, PowerListener, PowerStateProvider } from '../PowerStateProvider';

export class FakePowerStateProvider implements PowerStateProvider {
  private charging = false;
  private readonly listeners = new Set<PowerListener>();

  async isCharging(): Promise<boolean> {
    return this.charging;
  }

  subscribe(listener: PowerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of active subscriptions (leak assertions in tests). */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  simulateChargingStarted(at: EpochMs): void {
    this.charging = true;
    this.emit({ type: 'CHARGING_STARTED', at });
  }

  simulateChargingStopped(at: EpochMs): void {
    this.charging = false;
    this.emit({ type: 'CHARGING_STOPPED', at });
  }

  /** Heartbeats do not change isCharging() — mirrors the real provider's semantics. */
  simulateHeartbeat(at: EpochMs): void {
    this.emit({ type: 'CHARGING_HEARTBEAT', at });
  }

  private emit(event: PowerEvent): void {
    // Copy: a listener may unsubscribe (itself or others) while being notified.
    for (const listener of [...this.listeners]) listener(event);
  }
}
