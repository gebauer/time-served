/**
 * Per-group leaderboard (BUILD_V1 §11 screen 6) — period tabs Gestern/Woche/
 * Gesamt over J2's buildLeaderboard; day/night split per row; long-press a row
 * for a LOCAL rename (nick_overrides — never synced).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import type { LeaderboardPeriod, LeaderboardRow, UserId } from '../../domain/types';
import { Button, Card, EmptyState, Field, Screen } from '../components/primitives';
import { formatDuration } from '../format';
import { useLeaderboard } from '../hooks/useLeaderboard';
import type { RootStackParamList } from '../navigation';
import { strings } from '../strings';
import { radius, spacing, typography, useTheme } from '../theme';

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'yesterday', label: strings.groups.periodYesterday },
  { key: 'week', label: strings.groups.periodWeek },
  { key: 'all-time', label: strings.groups.periodAllTime },
];

export function LeaderboardScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Leaderboard'>>();
  const { groupId } = route.params;
  const { colors } = useTheme();
  const [period, setPeriod] = useState<LeaderboardPeriod>('yesterday');
  const { rows, myUserId, rename, clearRename } = useLeaderboard(groupId, period);
  const [renaming, setRenaming] = useState<{ userId: UserId; name: string } | undefined>(
    undefined,
  );
  const [renameValue, setRenameValue] = useState('');

  const hasAnyTime = rows !== undefined && rows.some((row) => row.totalSec > 0);

  return (
    <Screen>
      <View style={[styles.tabs, { backgroundColor: colors.surfaceAlt }]}>
        {PERIODS.map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === key }}
            onPress={() => setPeriod(key)}
            style={[
              styles.tab,
              period === key && { backgroundColor: colors.surface },
            ]}
          >
            <Text
              style={[
                typography.caption,
                {
                  color: period === key ? colors.text : colors.textMuted,
                  fontWeight: period === key ? '600' : '400',
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {rows === undefined ? (
        <EmptyState text={strings.common.loading} />
      ) : !hasAnyTime ? (
        <EmptyState text={strings.groups.emptyLeaderboard} />
      ) : (
        <Card style={styles.board}>
          {rows.map((row) => (
            <LeaderboardRowView
              key={row.userId}
              row={row}
              isMe={row.userId === myUserId}
              onLongPress={() => {
                setRenaming({ userId: row.userId, name: row.displayName });
                setRenameValue(row.displayName);
              }}
            />
          ))}
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.groups.renameHint}
          </Text>
        </Card>
      )}

      {renaming !== undefined && (
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>
            {strings.groups.renameTitle}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {strings.groups.renameDescription}
          </Text>
          <Field
            label={strings.groups.renamePlaceholder}
            value={renameValue}
            onChangeText={setRenameValue}
            autoFocus
          />
          <View style={styles.renameActions}>
            <Button
              label={strings.common.save}
              disabled={renameValue.trim().length === 0}
              onPress={() => {
                void rename(renaming.userId, renameValue.trim());
                setRenaming(undefined);
              }}
            />
            <Button
              label={strings.groups.renameReset}
              variant="secondary"
              onPress={() => {
                void clearRename(renaming.userId);
                setRenaming(undefined);
              }}
            />
            <Button
              label={strings.common.cancel}
              variant="ghost"
              onPress={() => setRenaming(undefined)}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

function LeaderboardRowView({
  row,
  isMe,
  onLongPress,
}: {
  row: LeaderboardRow;
  isMe: boolean;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onLongPress={onLongPress}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <Text style={[typography.heading, styles.rank, { color: colors.textMuted }]}>
        {row.rank}
      </Text>
      <View style={styles.rowBody}>
        <Text style={[typography.body, { color: colors.text, fontWeight: isMe ? '700' : '500' }]}>
          {row.displayName}
          {isMe ? ` ${strings.groups.youMarker}` : ''}
        </Text>
        <View style={styles.split}>
          <View style={[styles.dot, { backgroundColor: colors.day }]} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {formatDuration(row.dayLockSec)}
          </Text>
          <View style={[styles.dot, { backgroundColor: colors.night }]} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {formatDuration(row.nightLockSec)}
          </Text>
        </View>
      </View>
      <Text style={[typography.body, { color: colors.text, fontWeight: '700' }]}>
        {formatDuration(row.totalSec)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md - 3,
  },
  board: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: 26,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  renameActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
