/**
 * DayNightBar — the signature visual (BUILD_V1 §11 screen 2): one horizontal
 * stacked bar per day, sun-yellow day segment, moon-blue night segment, subtle
 * remainder track. Pure presentational: props in, pixels out. Correct at 0
 * (empty track) and at 24h (full bar), accessible via a summary label.
 */
import { StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '../format';
import { fill, strings } from '../strings';
import { radius, spacing, typography, useTheme } from '../theme';
import { computeBarSegments, SECONDS_PER_DAY } from './daynightMath';

export interface DayNightBarProps {
  readonly dayLockSec: number;
  readonly nightLockSec: number;
  /** Scale of the full track; defaults to 24h so bars are comparable. */
  readonly maxSec?: number;
  /** Compact: thinner bar, single-line totals — for History rows. */
  readonly compact?: boolean;
}

export function DayNightBar({
  dayLockSec,
  nightLockSec,
  maxSec = SECONDS_PER_DAY,
  compact = false,
}: DayNightBarProps) {
  const { colors } = useTheme();
  const segments = computeBarSegments(dayLockSec, nightLockSec, maxSec);
  const barHeight = compact ? 10 : 18;

  const accessibilityLabel = fill(strings.dayNightBar.accessibility, {
    day: formatDuration(dayLockSec),
    night: formatDuration(nightLockSec),
  });

  return (
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View
        style={[
          styles.track,
          { height: barHeight, borderRadius: barHeight / 2, backgroundColor: colors.surfaceAlt },
        ]}
      >
        {segments.dayFraction > 0 && (
          <View style={{ flex: segments.dayFraction, backgroundColor: colors.day }} />
        )}
        {segments.nightFraction > 0 && (
          <View style={{ flex: segments.nightFraction, backgroundColor: colors.night }} />
        )}
        {segments.restFraction > 0 && <View style={{ flex: segments.restFraction }} />}
      </View>

      <View style={[styles.legend, compact && styles.legendCompact]}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.day }]} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {strings.dayNightBar.dayLabel}{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {formatDuration(dayLockSec)}
            </Text>
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.night }]} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {strings.dayNightBar.nightLabel}{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {formatDuration(nightLockSec)}
            </Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    overflow: 'hidden',
    width: '100%',
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  legendCompact: {
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: radius.sm / 2,
  },
});
