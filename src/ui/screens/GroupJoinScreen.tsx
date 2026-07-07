/**
 * Group join (BUILD_V1 §10.4/§11) — invite link (pasted, or prefilled by the
 * J10 deep-link handler in App.tsx) → nickname → EXPLICIT consent toggle with the
 * exact meaning: "Diese Gruppe darf meine täglichen Summen sehen".
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { Button, Card, Field, Screen } from '../components/primitives';
import { useGroups } from '../hooks/useGroups';
import type { RootStackParamList } from '../navigation';
import { strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

export function GroupJoinScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupJoin'>>();
  const { join, parseInvite } = useGroups();
  const { colors } = useTheme();

  const [link, setLink] = useState(route.params?.inviteUrl ?? '');
  const [nickname, setNickname] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const linkValid = link.trim().length > 0 && parseInvite(link.trim()) !== undefined;

  return (
    <Screen>
      <Card>
        <Text style={[typography.heading, { color: colors.text }]}>
          {strings.groups.joinTitle}
        </Text>
        <Field
          label={strings.groups.linkField}
          value={link}
          onChangeText={(value) => {
            setLink(value);
            setError(undefined);
          }}
          placeholder={strings.groups.linkPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {link.trim().length > 0 && !linkValid && (
          <Text style={[typography.caption, { color: colors.danger }]}>
            {strings.groups.linkInvalid}
          </Text>
        )}
        <Field
          label={strings.groups.nicknameField}
          value={nickname}
          onChangeText={setNickname}
          placeholder={strings.groups.nicknamePlaceholder}
        />

        <View style={styles.consentRow}>
          <Switch
            value={consent}
            onValueChange={setConsent}
            accessibilityLabel={strings.groups.consentLabel}
          />
          <View style={styles.consentText}>
            <Text style={[typography.body, { color: colors.text }]}>
              {strings.groups.consentLabel}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {strings.groups.consentHint}
            </Text>
          </View>
        </View>

        {error !== undefined && (
          <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
        )}

        <Button
          label={strings.groups.joinButton}
          busy={busy}
          disabled={!linkValid || nickname.trim().length === 0}
          onPress={() => {
            setBusy(true);
            void join(link.trim(), nickname.trim(), consent).then(
              () => navigation.goBack(),
              () => {
                setBusy(false);
                // Honest copy: the link already validated locally — a rejected
                // join here is usually network/server, not a malformed link.
                setError(strings.groups.joinFailed);
              },
            );
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  consentText: {
    flex: 1,
    gap: spacing.xs,
  },
});
