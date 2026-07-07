/**
 * History (BUILD_V1 §11 screen 5) — day list with the DayNightBar, expandable
 * sessions (start–end, duration, honest end_reason badge incl. "nachträglich
 * abgeschlossen" for reconciled closes), sealed days visibly locked and
 * read-only; edits (shift start/end by 15 min, delete) only on unsealed days.
 */
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionEndReason } from '../../domain/types';
import { DayNightBar } from '../components/DayNightBar';
import { Button, Card, Chip, EmptyState, Screen } from '../components/primitives';
import { formatClockTime, formatDuration, formatLocalDate } from '../format';
import type { HistorySession } from '../hooks/historyLogic';
import { useHistory, type HistoryDay } from '../hooks/useHistory';
import { useSessionEditor } from '../hooks/useSessionEditor';
import { useAppServices } from '../services/AppServicesContext';
import { strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

const EDIT_STEP_MS = 15 * 60 * 1000;

const END_REASON_LABEL: Record<SessionEndReason, string> = {
  unplug: strings.history.endReasonUnplug,
  reconciled: strings.history.endReasonReconciled,
  manual: strings.history.endReasonManual,
};

export function HistoryScreen() {
  const history = useHistory(30);
  const { colors } = useTheme();
  const [expandedDate, setExpandedDate] = useState<string | undefined>(undefined);

  if (history === undefined) {
    return (
      <Screen scroll={false}>
        <EmptyState text={strings.common.loading} />
      </Screen>
    );
  }
  if (history.days.length === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState text={strings.history.empty} />
      </Screen>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.listContent}
      data={history.days}
      keyExtractor={(day) => day.date}
      renderItem={({ item }) => (
        <DayCard
          day={item}
          boxLabel={(boxId) => history.boxLabels.get(boxId) ?? '?'}
          expanded={expandedDate === item.date}
          onToggle={() =>
            setExpandedDate((current) => (current === item.date ? undefined : item.date))
          }
        />
      )}
    />
  );
}

function DayCard({
  day,
  boxLabel,
  expanded,
  onToggle,
}: {
  day: HistoryDay;
  boxLabel: (boxId: HistorySession['session']['boxId']) => string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.dayCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
      >
        <View style={styles.dayHeader}>
          <Text style={[typography.heading, { color: colors.text }]}>
            {formatLocalDate(day.date)}
          </Text>
          {day.sealed && <SealedBadge />}
        </View>
        <DayNightBar dayLockSec={day.dayLockSec} nightLockSec={day.nightLockSec} compact />
      </Pressable>

      {expanded && (
        <View style={styles.sessionList}>
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.history.sessionsHeading}
          </Text>
          {day.sessions.length === 0 ? (
            <Text style={[typography.caption, { color: colors.textFaint }]}>
              {strings.history.noSessions}
            </Text>
          ) : (
            day.sessions.map((entry) => (
              <SessionRow
                key={entry.session.id}
                entry={entry}
                sealed={day.sealed}
                boxLabel={boxLabel(entry.session.boxId)}
              />
            ))
          )}
          {day.sealed && (
            <Text style={[typography.caption, { color: colors.textFaint }]}>
              {strings.history.sealedHint}
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}

function SealedBadge() {
  const { colors } = useTheme();
  return (
    <View style={styles.sealedBadge}>
      {/* Lock glyph drawn with views — no icon lib. */}
      <View style={[styles.lockShackle, { borderColor: colors.textMuted }]} />
      <View style={[styles.lockBody, { backgroundColor: colors.textMuted }]} />
      <Text style={[typography.caption, { color: colors.textMuted, marginLeft: spacing.xs }]}>
        {strings.history.sealedBadge}
      </Text>
    </View>
  );
}

function SessionRow({
  entry,
  sealed,
  boxLabel,
}: {
  entry: HistorySession;
  sealed: boolean;
  boxLabel: string;
}) {
  const { colors } = useTheme();
  const { settings } = useAppServices();
  const editor = useSessionEditor();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeZone = settings.timeZone;
  const reason = entry.session.endReason;

  return (
    <View style={[styles.sessionRow, { borderTopColor: colors.border }]}>
      <View style={styles.sessionInfo}>
        <Text style={[typography.body, { color: colors.text }]}>
          {formatClockTime(entry.startedAt, timeZone)} – {formatClockTime(entry.endedAt, timeZone)}
          {'  '}
          <Text style={{ color: colors.textMuted }}>
            ({formatDuration(entry.durationSec)})
          </Text>
        </Text>
        <View style={styles.sessionMeta}>
          <Chip label={boxLabel} />
          {reason !== undefined && (
            <Chip
              label={END_REASON_LABEL[reason]}
              tone={reason === 'reconciled' ? 'night' : 'neutral'}
            />
          )}
        </View>
      </View>

      {!sealed && !editing && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing(true)}
          style={styles.editButton}
        >
          <Text style={[typography.caption, { color: colors.action, fontWeight: '600' }]}>
            {strings.common.edit}
          </Text>
        </Pressable>
      )}

      {editing && (
        <View style={styles.editor}>
          <TimeAdjuster
            label={strings.history.startLabel}
            value={formatClockTime(entry.startedAt, timeZone)}
            onShift={(deltaMs) =>
              void editor.updateTimes(
                entry.session.id,
                entry.startedAt + deltaMs,
                entry.endedAt,
              )
            }
          />
          <TimeAdjuster
            label={strings.history.endLabel}
            value={formatClockTime(entry.endedAt, timeZone)}
            onShift={(deltaMs) =>
              void editor.updateTimes(
                entry.session.id,
                entry.startedAt,
                entry.endedAt + deltaMs,
              )
            }
          />
          {confirmDelete ? (
            <View style={styles.editorActions}>
              <Text style={[typography.caption, { color: colors.textMuted, flex: 1 }]}>
                {strings.history.deleteConfirm}
              </Text>
              <Button
                label={strings.common.delete}
                variant="danger"
                onPress={() => void editor.remove(entry.session.id)}
              />
              <Button
                label={strings.common.cancel}
                variant="ghost"
                onPress={() => setConfirmDelete(false)}
              />
            </View>
          ) : (
            <View style={styles.editorActions}>
              <Button
                label={strings.history.deleteSession}
                variant="ghost"
                onPress={() => setConfirmDelete(true)}
              />
              <Button
                label={strings.common.done}
                variant="secondary"
                onPress={() => setEditing(false)}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function TimeAdjuster({
  label,
  value,
  onShift,
}: {
  label: string;
  value: string;
  onShift: (deltaMs: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.adjusterRow}>
      <Text style={[typography.caption, { color: colors.textMuted, width: 44 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} 15 Minuten früher`}
        onPress={() => onShift(-EDIT_STEP_MS)}
        style={[styles.adjustButton, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={[typography.body, { color: colors.text }]}>−15</Text>
      </Pressable>
      <Text
        style={[
          typography.body,
          { color: colors.text, fontVariant: ['tabular-nums'], minWidth: 52, textAlign: 'center' },
        ]}
      >
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} 15 Minuten später`}
        onPress={() => onShift(EDIT_STEP_MS)}
        style={[styles.adjustButton, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={[typography.body, { color: colors.text }]}>+15</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  dayCard: {
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sealedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockShackle: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    marginBottom: -2,
    alignSelf: 'center',
  },
  lockBody: {
    width: 11,
    height: 8,
    borderRadius: 2,
    marginLeft: -9.5,
    marginTop: 6,
  },
  sessionList: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sessionRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  sessionInfo: {
    gap: spacing.xs,
  },
  sessionMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  editor: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  adjusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  adjustButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
});
