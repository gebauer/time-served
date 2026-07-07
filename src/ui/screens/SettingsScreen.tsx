/**
 * Settings (BUILD_V1 §11 screen 7) — per-group nicknames, ARM_TIMEOUT,
 * day/night window hours, seal time, battery-optimization status (placeholder
 * until J11), sync toggle, anonymous-identity blurb. Dev harness entry in
 * debug builds.
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button, Card, Field, Screen, SectionHeader, Stepper } from '../components/primitives';
import { formatHour } from '../format';
import { useGroups } from '../hooks/useGroups';
import { useSettings } from '../hooks/useSettings';
import { useAppServices } from '../services/AppServicesContext';
import type { RootStackParamList } from '../navigation';
import type { GroupSummary } from '../services/AppServicesContext';
import { strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { values, update } = useSettings();
  const { groups, setNickname } = useGroups();
  const { dev } = useAppServices();
  const { colors } = useTheme();

  const clampHour = (hour: number) => ((hour % 24) + 24) % 24;

  return (
    <Screen>
      <SectionHeader>{strings.settings.nicknamesHeading}</SectionHeader>
      <Card>
        {groups === undefined || groups.length === 0 ? (
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.groups.empty}
          </Text>
        ) : (
          groups.map((group) => (
            <NicknameRow
              key={group.groupId}
              group={group}
              onSave={(nick) => void setNickname(group.groupId, nick)}
            />
          ))
        )}
      </Card>

      <SectionHeader>{strings.settings.timesHeading}</SectionHeader>
      <Card>
        <SettingRow
          label={strings.settings.armTimeoutLabel}
          hint={strings.settings.armTimeoutHint}
        >
          <Stepper
            value={values.armTimeoutSec}
            display={`${values.armTimeoutSec} ${strings.settings.secondsUnit}`}
            onDecrement={() =>
              void update({ armTimeoutSec: Math.max(30, values.armTimeoutSec - 30) })
            }
            onIncrement={() =>
              void update({ armTimeoutSec: Math.min(600, values.armTimeoutSec + 30) })
            }
          />
        </SettingRow>
        <SettingRow label={strings.settings.dayStartLabel}>
          <Stepper
            value={values.dayStartHour}
            display={formatHour(values.dayStartHour)}
            onDecrement={() => void update({ dayStartHour: clampHour(values.dayStartHour - 1) })}
            onIncrement={() => void update({ dayStartHour: clampHour(values.dayStartHour + 1) })}
          />
        </SettingRow>
        <SettingRow label={strings.settings.nightStartLabel}>
          <Stepper
            value={values.nightStartHour}
            display={formatHour(values.nightStartHour)}
            onDecrement={() =>
              void update({ nightStartHour: clampHour(values.nightStartHour - 1) })
            }
            onIncrement={() =>
              void update({ nightStartHour: clampHour(values.nightStartHour + 1) })
            }
          />
        </SettingRow>
        <SettingRow
          label={strings.settings.sealHourLabel}
          hint={strings.settings.sealHourHint}
        >
          <Stepper
            value={values.sealHourLocal}
            display={formatHour(values.sealHourLocal)}
            onDecrement={() => void update({ sealHourLocal: clampHour(values.sealHourLocal - 1) })}
            onIncrement={() => void update({ sealHourLocal: clampHour(values.sealHourLocal + 1) })}
          />
        </SettingRow>
      </Card>

      <SectionHeader>{strings.settings.systemHeading}</SectionHeader>
      <Card>
        <SettingRow label={strings.settings.batteryOptLabel}>
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {strings.settings.batteryOptUnknown}
          </Text>
        </SettingRow>
        <SettingRow label={strings.settings.syncLabel} hint={strings.settings.syncHint}>
          <Switch
            value={values.syncEnabled}
            onValueChange={(syncEnabled) => void update({ syncEnabled })}
            accessibilityLabel={strings.settings.syncLabel}
          />
        </SettingRow>
      </Card>

      <SectionHeader>{strings.settings.identityHeading}</SectionHeader>
      <Card>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {strings.settings.identityBlurb}
        </Text>
      </Card>

      {dev !== undefined && (
        <>
          <SectionHeader>{strings.settings.devHeading}</SectionHeader>
          <Button
            label={strings.settings.openDevHarness}
            variant="secondary"
            onPress={() => navigation.navigate('DevHarness')}
          />
        </>
      )}
    </Screen>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingText}>
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
        {hint !== undefined && (
          <Text style={[typography.caption, { color: colors.textFaint }]}>{hint}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

function NicknameRow({
  group,
  onSave,
}: {
  group: GroupSummary;
  onSave: (nickname: string) => void;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(group.myNickname);

  if (!editing) {
    return (
      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <Text style={[typography.body, { color: colors.text }]}>{group.name}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {group.myNickname}
          </Text>
        </View>
        <Button
          label={strings.common.edit}
          variant="ghost"
          onPress={() => {
            setValue(group.myNickname);
            setEditing(true);
          }}
        />
      </View>
    );
  }
  return (
    <View>
      <Field label={group.name} value={value} onChangeText={setValue} autoFocus />
      <View style={styles.nickActions}>
        <Button
          label={strings.common.save}
          disabled={value.trim().length === 0}
          onPress={() => {
            onSave(value.trim());
            setEditing(false);
          }}
        />
        <Button
          label={strings.common.cancel}
          variant="ghost"
          onPress={() => setEditing(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingText: {
    flex: 1,
    gap: spacing.xs,
  },
  nickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
