/**
 * Boxes (BUILD_V1 §11 screen 4) — own + foreign boxes; foreign are read-only
 * and marked "von anderem Mitglied" (§9.2). Register wizard on its own screen.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { Box } from '../../domain/types';
import { Button, Card, Chip, EmptyState, Field, Screen } from '../components/primitives';
import { useBoxes } from '../hooks/useBoxes';
import type { RootStackParamList } from '../navigation';
import { strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

export function BoxesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { boxes, updateBox, deleteBox } = useBoxes();

  return (
    <Screen>
      <Button
        label={strings.boxes.registerNew}
        onPress={() => navigation.navigate('BoxWizard')}
      />
      {boxes === undefined ? (
        <EmptyState text={strings.common.loading} />
      ) : boxes.length === 0 ? (
        <EmptyState text={strings.boxes.empty} />
      ) : (
        boxes.map((box) => (
          <BoxCard
            key={box.id}
            box={box}
            onSave={(label, location) => void updateBox(box.id, { label, location })}
            onDelete={() => void deleteBox(box.id)}
          />
        ))
      )}
    </Screen>
  );
}

function BoxCard({
  box,
  onSave,
  onDelete,
}: {
  box: Box;
  onSave: (label: string, location: string) => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [label, setLabel] = useState(box.label);
  const [location, setLocation] = useState(box.location ?? '');
  const own = box.origin === 'own';

  return (
    <Card>
      <View style={styles.header}>
        <Text style={[typography.heading, { color: colors.text }]}>{box.label}</Text>
        {!own && <Chip label={strings.boxes.foreignBadge} tone="night" />}
      </View>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {box.location ?? strings.boxes.locationFallback}
      </Text>

      {own && !editing && (
        <View style={styles.actions}>
          <Button
            label={strings.common.edit}
            variant="secondary"
            onPress={() => {
              setLabel(box.label);
              setLocation(box.location ?? '');
              setEditing(true);
            }}
          />
          {confirmDelete ? (
            <>
              <Button label={strings.common.delete} variant="danger" onPress={onDelete} />
              <Button
                label={strings.common.cancel}
                variant="ghost"
                onPress={() => setConfirmDelete(false)}
              />
            </>
          ) : (
            <Button
              label={strings.common.delete}
              variant="ghost"
              onPress={() => setConfirmDelete(true)}
            />
          )}
        </View>
      )}
      {own && confirmDelete && (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {strings.boxes.deleteConfirm}
        </Text>
      )}

      {own && editing && (
        <View>
          <Field
            label={strings.boxes.labelField}
            value={label}
            onChangeText={setLabel}
            placeholder={strings.wizard.labelPlaceholder}
          />
          <Field
            label={strings.boxes.locationField}
            value={location}
            onChangeText={setLocation}
            placeholder={strings.wizard.locationPlaceholder}
          />
          <View style={styles.actions}>
            <Button
              label={strings.common.save}
              disabled={label.trim().length === 0}
              onPress={() => {
                onSave(label.trim(), location.trim());
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
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
});
