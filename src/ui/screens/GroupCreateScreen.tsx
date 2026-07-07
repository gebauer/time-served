/**
 * Group create (BUILD_V1 §10.4/§11) — name + own nickname → the gateway
 * generates the group key and invite link (stub crypto until J10). The key
 * travels only in the link fragment; the screen shows the link for sharing.
 */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button, Card, Field, Screen } from '../components/primitives';
import { useToast } from '../components/Toast';
import { useGroups } from '../hooks/useGroups';
import { strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

export function GroupCreateScreen() {
  const navigation = useNavigation();
  const { create } = useGroups();
  const { colors } = useTheme();
  const toast = useToast();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | undefined>(undefined);

  if (inviteLink !== undefined) {
    return (
      <Screen>
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>
            {strings.groups.inviteHeading}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {strings.groups.inviteHint}
          </Text>
          <Text
            selectable
            style={[typography.mono, styles.link, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          >
            {inviteLink}
          </Text>
          <Button label={strings.common.done} onPress={() => navigation.goBack()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={[typography.heading, { color: colors.text }]}>
          {strings.groups.createTitle}
        </Text>
        <Field
          label={strings.groups.nameField}
          value={name}
          onChangeText={setName}
          placeholder={strings.groups.namePlaceholder}
          autoFocus
        />
        <Field
          label={strings.groups.nicknameField}
          value={nickname}
          onChangeText={setNickname}
          placeholder={strings.groups.nicknamePlaceholder}
        />
        <Button
          label={strings.groups.createButton}
          busy={busy}
          disabled={name.trim().length === 0 || nickname.trim().length === 0}
          onPress={() => {
            setBusy(true);
            void create(name.trim(), nickname.trim()).then(
              (result) => setInviteLink(result.inviteLink),
              () => {
                setBusy(false);
                toast.show(strings.groups.createFailed, 'danger');
              },
            );
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: {
    padding: spacing.md,
    borderRadius: 8,
    marginVertical: spacing.sm,
  },
});
