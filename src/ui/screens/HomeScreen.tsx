/**
 * Home / Status (BUILD_V1 §11 screen 1) — IDLE instruction, ARMED countdown,
 * ACTIVE elapsed. The elapsed display DERIVES from persisted `startedAt` on
 * every render; the 1s interval (useNowTick) runs only while this screen is
 * focused and measures nothing (CLAUDE.md §3/§10). Hero element: today's
 * DayNightBar. J11: non-blocking NFC banner when the adapter is off/missing —
 * everything else on the screen keeps working.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Box, BoxId, EpochMs, SessionState } from '../../domain/types';
import { DayNightBar } from '../components/DayNightBar';
import { Button, Card, Chip, Screen } from '../components/primitives';
import { formatClockTime, formatCountdown, formatElapsed } from '../format';
import { useNfcStatus } from '../hooks/useNfcStatus';
import { useNowTick } from '../hooks/useNowTick';
import { useSessionState } from '../hooks/useSessionState';
import { useTodayBuckets } from '../hooks/useTodayBuckets';
import { useAppServices } from '../services/AppServicesContext';
import { strings } from '../strings';
import { radius, spacing, typography, useTheme } from '../theme';

export function HomeScreen() {
  const state = useSessionState();
  const today = useTodayBuckets();
  const { colors } = useTheme();

  return (
    <Screen>
      <Text style={[typography.title, { color: colors.text }]}>{strings.app.name}</Text>

      <NfcBanner />

      <StatusCard state={state} />

      <Card>
        <Text style={[typography.heading, { color: colors.text }]}>
          {strings.home.todayHeading}
        </Text>
        <DayNightBar
          dayLockSec={today?.dayLockSec ?? 0}
          nightLockSec={today?.nightLockSec ?? 0}
        />
        {(today?.dayLockSec ?? 0) === 0 && (today?.nightLockSec ?? 0) === 0 && (
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.home.noTimeToday}
          </Text>
        )}
      </Card>
    </Screen>
  );
}

/**
 * Non-blocking NFC availability banner (J11): 'disabled' offers the system
 * NFC settings (the hook restarts the reader once NFC is back); 'unsupported'
 * states the limitation honestly — history/groups stay fully usable. Renders
 * nothing while checking or when NFC is fine.
 */
function NfcBanner() {
  const { colors } = useTheme();
  const { status, openNfcSettings } = useNfcStatus();
  if (status === undefined || status === 'ok') return null;

  return (
    <Card style={styles.nfcBanner}>
      <Text style={[typography.heading, { color: colors.text }]}>
        {status === 'disabled'
          ? strings.home.nfcOffTitle
          : strings.home.nfcUnsupportedTitle}
      </Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {status === 'disabled' ? strings.home.nfcOffBody : strings.home.nfcUnsupportedBody}
      </Text>
      {status === 'disabled' && (
        <Button
          label={strings.home.nfcOpenSettings}
          variant="secondary"
          onPress={openNfcSettings}
        />
      )}
    </Card>
  );
}

function StatusCard({ state }: { state: SessionState }) {
  switch (state.kind) {
    case 'IDLE':
      return <IdleCard />;
    case 'ARMED':
      return <ArmedCard armedAt={state.armedAt} boxId={state.boxId} />;
    case 'ACTIVE':
      return <ActiveCard startedAt={state.startedAt} boxId={state.boxId} />;
  }
}

/** Resolve a box label at the UI edge (display only). */
function useBoxLabel(boxId: BoxId): string {
  const { repositories } = useAppServices();
  const [label, setLabel] = useState<string>(boxId);
  useEffect(() => {
    let cancelled = false;
    void repositories.boxes.get(boxId).then((box: Box | undefined) => {
      if (!cancelled && box !== undefined) setLabel(box.label);
    });
    return () => {
      cancelled = true;
    };
  }, [repositories, boxId]);
  return label;
}

function IdleCard() {
  const { colors } = useTheme();
  return (
    <Card style={styles.statusCard}>
      <View style={[styles.illustration, { backgroundColor: colors.surfaceAlt }]}>
        {/* Illustration placeholder — box outline */}
        <View style={[styles.boxShape, { borderColor: colors.textFaint }]} />
        <View style={[styles.boxLid, { backgroundColor: colors.textFaint }]} />
      </View>
      <Text style={[typography.heading, styles.centered, { color: colors.text }]}>
        {strings.home.idleTitle}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.home.idleHint}
      </Text>
    </Card>
  );
}

function ArmedCard({ armedAt, boxId }: { armedAt: EpochMs; boxId: BoxId }) {
  const { colors } = useTheme();
  const { settings } = useAppServices();
  const now = useNowTick(true);
  const label = useBoxLabel(boxId);
  const remainingSec = settings.get().armTimeoutSec - (now - armedAt) / 1000;

  return (
    <Card style={styles.statusCard}>
      <Chip label={`${strings.home.boxLabel}: ${label}`} tone="day" />
      <Text style={[typography.heading, styles.centered, { color: colors.text }]}>
        {strings.home.armedTitle}
      </Text>
      <Text
        style={[typography.display, styles.centered, { color: colors.day }]}
        accessibilityLabel={`${strings.home.armedCountdownLabel}: ${formatCountdown(remainingSec)}`}
      >
        {formatCountdown(remainingSec)}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.home.armedHint}
      </Text>
    </Card>
  );
}

function ActiveCard({ startedAt, boxId }: { startedAt: EpochMs; boxId: BoxId }) {
  const { colors } = useTheme();
  const { settings } = useAppServices();
  const now = useNowTick(true);
  const label = useBoxLabel(boxId);
  const elapsedSec = Math.max(0, (now - startedAt) / 1000);

  return (
    <Card style={styles.statusCard}>
      <Chip label={`${strings.home.boxLabel}: ${label}`} tone="positive" />
      <Text style={[typography.heading, styles.centered, { color: colors.text }]}>
        {strings.home.activeTitle}
      </Text>
      <Text
        style={[typography.display, styles.centered, { color: colors.positive }]}
        accessibilityLabel={`${strings.home.activeTitle}: ${formatElapsed(elapsedSec)}`}
      >
        {formatElapsed(elapsedSec)}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.home.activeSince} {formatClockTime(startedAt, settings.timeZone)}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  nfcBanner: {
    gap: spacing.sm,
  },
  statusCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  centered: {
    textAlign: 'center',
  },
  illustration: {
    width: 120,
    height: 90,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  boxShape: {
    width: 64,
    height: 40,
    borderWidth: 2,
    borderRadius: radius.sm,
  },
  boxLid: {
    position: 'absolute',
    top: 20,
    width: 76,
    height: 4,
    borderRadius: 2,
  },
});
