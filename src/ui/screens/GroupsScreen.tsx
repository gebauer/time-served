/**
 * Groups (BUILD_V1 §11 screen 6) — list of groups, entry points for create and
 * join, tap-through to the per-group leaderboard.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button, Card, Chip, EmptyState, Screen } from '../components/primitives';
import { useGroups } from '../hooks/useGroups';
import type { RootStackParamList } from '../navigation';
import { fill, strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

export function GroupsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { groups } = useGroups();
  const { colors } = useTheme();

  return (
    <Screen>
      <View style={styles.actions}>
        <Button
          label={strings.groups.create}
          onPress={() => navigation.navigate('GroupCreate')}
        />
        <Button
          label={strings.groups.join}
          variant="secondary"
          onPress={() => navigation.navigate('GroupJoin')}
        />
      </View>

      {groups === undefined ? (
        <EmptyState text={strings.common.loading} />
      ) : groups.length === 0 ? (
        <EmptyState text={strings.groups.empty} />
      ) : (
        groups.map((group) => (
          <Pressable
            key={group.groupId}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Leaderboard', {
                groupId: group.groupId,
                groupName: group.name,
              })
            }
          >
            <Card>
              <View style={styles.groupHeader}>
                <Text style={[typography.heading, { color: colors.text }]}>{group.name}</Text>
                {group.role === 'owner' && <Chip label={strings.groups.ownerBadge} />}
              </View>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {fill(strings.groups.membersCount, { count: group.memberCount })}
                {' · '}
                {group.myNickname}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
