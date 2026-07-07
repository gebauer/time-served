/**
 * Settings (BUILD_V1 §11 screen 7) — per-group nicknames, ARM_TIMEOUT,
 * day/night window hours, seal time, REAL battery-optimization + notification
 * status (J11, over the SystemStatusService seam), sync toggle,
 * anonymous-identity blurb. Dev harness entry in debug builds.
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button, Card, Field, Screen, SectionHeader, Stepper } from '../components/primitives';
import { useToast } from '../components/Toast';
import { formatHour } from '../format';
import { useGroups } from '../hooks/useGroups';
import { useSettings } from '../hooks/useSettings';
import { useSystemStatus } from '../hooks/useSystemStatus';
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
  const toast = useToast();

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
              onSave={(nick) =>
                void setNickname(group.groupId, nick).catch(() =>
                  toast.show(strings.groups.nicknameFailed, 'danger'),
                )
              }
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
        <SystemPermissionRows />
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

/**
 * J11: live battery-exemption + notification-permission status (BUILD_V1 §8.5
 * / §11 screen 7). States refresh on refocus (both system dialogs resolve
 * outside the app). A denied notification permission cannot be re-requested
 * once permanently denied — the button then leads to the app settings page.
 */
function SystemPermissionRows() {
  const { colors } = useTheme();
  const status = useSystemStatus();
  const [notifAsked, setNotifAsked] = useState(false);

  const batteryText =
    status.battery === 'granted'
      ? strings.settings.batteryOptGranted
      : status.battery === 'denied'
        ? strings.settings.batteryOptDenied
        : strings.settings.batteryOptUnavailable;
  const notifText =
    status.notifications === 'granted'
      ? strings.settings.notificationsGranted
      : status.notifications === 'denied'
        ? strings.settings.notificationsDenied
        : strings.settings.notificationsUnavailable;

  return (
    <>
      <SettingRow
        label={strings.settings.batteryOptLabel}
        hint={status.battery === 'denied' ? strings.settings.batteryOptDeniedHint : undefined}
      >
        {status.battery === 'denied' ? (
          <Button
            label={strings.settings.batteryOptRequest}
            variant="secondary"
            onPress={() => void status.requestBattery()}
          />
        ) : (
          <Text style={[typography.caption, styles.statusText, { color: colors.textMuted }]}>
            {status.battery === undefined ? strings.common.loading : batteryText}
          </Text>
        )}
      </SettingRow>
      <SettingRow
        label={strings.settings.notificationsLabel}
        hint={
          status.notifications === 'denied'
            ? strings.settings.notificationsDeniedHint
            : undefined
        }
      >
        {status.notifications === 'denied' ? (
          <Button
            label={
              notifAsked
                ? strings.settings.openAppSettings
                : strings.settings.notificationsRequest
            }
            variant="secondary"
            onPress={() => {
              if (notifAsked) {
                status.openAppSettings();
                return;
              }
              void status.requestNotifications().then((state) => {
                // Request came back denied without a dialog → permanently
                // denied; escalate the button to the app settings page.
                if (state === 'denied') setNotifAsked(true);
              });
            }}
          />
        ) : (
          <Text style={[typography.caption, styles.statusText, { color: colors.textMuted }]}>
            {status.notifications === undefined ? strings.common.loading : notifText}
          </Text>
        )}
      </SettingRow>
    </>
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
  statusText: {
    maxWidth: 160,
    textAlign: 'right',
  },
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
