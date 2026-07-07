/**
 * Dev harness (JOBS.md J8, debug builds only) — the emulator has no NFC and no
 * physical plug, so this screen injects domain events via the fakes, time-
 * travels the offset clock, and shows a live state readout (machine state,
 * open sessions, dirty buckets). Reachable from Settings in __DEV__ builds.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Box } from '../../domain/types';
import { Button, Card, EmptyState, Screen, SectionHeader } from '../components/primitives';
import { fill, strings } from '../strings';
import {
  useAppServices,
  type DebugSnapshot,
} from '../services/AppServicesContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { spacing, typography, useTheme } from '../theme';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function DevHarnessScreen() {
  const { dev, repositories } = useAppServices();
  const { colors } = useTheme();
  const { data: boxes } = useAsyncData(() => repositories.boxes.list(), []);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | undefined>(undefined);

  const refresh = useCallback(() => {
    if (dev === undefined) return;
    void dev.snapshot().then(setSnapshot);
  }, [dev]);

  useEffect(refresh, [refresh]);

  if (dev === undefined) {
    return (
      <Screen scroll={false}>
        <EmptyState text="Nur in Debug-Builds verfügbar." />
      </Screen>
    );
  }

  const after = (action: () => void) => () => {
    action();
    // Dispatches settle async; refresh shortly after.
    setTimeout(refresh, 50);
  };

  return (
    <Screen>
      <SectionHeader>{strings.dev.eventsHeading}</SectionHeader>
      <Card style={styles.buttonColumn}>
        {boxes === undefined || boxes.length === 0 ? (
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.dev.noBoxes}
          </Text>
        ) : (
          boxes.map((box: Box) => (
            <Button
              key={box.id}
              label={fill(strings.dev.tagReadFor, { label: box.label })}
              variant="secondary"
              onPress={after(() => dev.simulateTagRead(box.id, box.label))}
            />
          ))
        )}
        <Button
          label={strings.dev.chargingStarted}
          variant="secondary"
          onPress={after(dev.simulateChargingStarted)}
        />
        <Button
          label={strings.dev.chargingStopped}
          variant="secondary"
          onPress={after(dev.simulateChargingStopped)}
        />
        <Button
          label={strings.dev.heartbeat}
          variant="secondary"
          onPress={after(dev.simulateHeartbeat)}
        />
        <Button
          label={strings.dev.appResumed}
          variant="secondary"
          onPress={after(dev.fireAppResumed)}
        />
        <Button
          label={strings.dev.armTimeout}
          variant="secondary"
          onPress={after(dev.fireArmTimeout)}
        />
      </Card>

      <SectionHeader>{strings.dev.clockHeading}</SectionHeader>
      <Card style={styles.buttonColumn}>
        <View style={styles.clockRow}>
          <Button
            label={strings.dev.plusHour}
            variant="secondary"
            onPress={after(() => dev.advanceClock(HOUR_MS))}
          />
          <Button
            label={strings.dev.plusDay}
            variant="secondary"
            onPress={after(() => dev.advanceClock(DAY_MS))}
          />
          <Button
            label={strings.dev.resetClock}
            variant="ghost"
            onPress={after(dev.resetClock)}
          />
        </View>
      </Card>

      <SectionHeader>{strings.dev.stateHeading}</SectionHeader>
      <Card>
        <Button label={strings.dev.refresh} variant="secondary" onPress={refresh} />
        {snapshot !== undefined && (
          <View style={styles.readout}>
            <ReadoutLine label={strings.dev.machineState} value={describeState(snapshot)} />
            <ReadoutLine
              label={strings.dev.clockNow}
              value={new Date(snapshot.clockNow).toISOString()}
            />
            <ReadoutLine
              label={strings.dev.clockOffset}
              value={`${Math.round(snapshot.clockOffsetMs / 60000)} min`}
            />
            <ReadoutLine
              label={strings.dev.openSessions}
              value={
                snapshot.openSessions.length === 0
                  ? '—'
                  : snapshot.openSessions
                      .map(
                        (session) =>
                          `${session.id.slice(0, 8)}… seit ${new Date(
                            session.startedAt ?? session.createdAt,
                          ).toISOString()}`,
                      )
                      .join('\n')
              }
            />
            <ReadoutLine
              label={strings.dev.dirtyBuckets}
              value={
                snapshot.dirtyBuckets.length === 0
                  ? '—'
                  : snapshot.dirtyBuckets
                      .map(
                        (bucket) =>
                          `${bucket.date}: Tag ${bucket.dayLockSec}s / Nacht ${bucket.nightLockSec}s`,
                      )
                      .join('\n')
              }
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}

function describeState(snapshot: DebugSnapshot): string {
  const state = snapshot.machineState;
  switch (state.kind) {
    case 'IDLE':
      return 'IDLE';
    case 'ARMED':
      return `ARMED (box ${state.boxId.slice(0, 8)}…, seit ${new Date(state.armedAt).toISOString()})`;
    case 'ACTIVE':
      return `ACTIVE (box ${state.boxId.slice(0, 8)}…, seit ${new Date(state.startedAt).toISOString()})`;
  }
}

function ReadoutLine({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.readoutLine}>
      <Text style={[typography.caption, { color: colors.textFaint }]}>{label}</Text>
      <Text style={[typography.mono, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonColumn: {
    gap: spacing.sm,
  },
  clockRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  readout: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  readoutLine: {
    gap: 2,
  },
});
