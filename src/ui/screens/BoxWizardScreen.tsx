/**
 * Register-new-box wizard (BUILD_V1 §9.3/§9.4) — renders the useBoxWizard
 * state machine: label/location → per-tag write step with live TagState
 * (blank / foreign-warn / ours / locked-foreign) → write+verify progress →
 * the EXPLICIT lock dialog (default NO, irreversibility spelled out) →
 * "write another tag?" loop.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import type { TagState } from '../../platform/TagReader';
import { Button, Card, Chip, Field, Screen } from '../components/primitives';
import { useBoxWizard, type WizardPhase, type WriteError } from '../hooks/useBoxWizard';
import { useAppServices } from '../services/AppServicesContext';
import { fill, strings } from '../strings';
import { spacing, typography, useTheme } from '../theme';

const ERROR_TEXT: Record<WriteError, string> = {
  'write-failed': strings.wizard.writeFailed,
  'verify-failed': strings.wizard.verifyFailed,
  'lock-failed': strings.wizard.lockFailed,
  'tag-lost': strings.wizard.tagLost,
};

export function BoxWizardScreen() {
  const navigation = useNavigation();
  const wizard = useBoxWizard();
  const { colors } = useTheme();

  // Backing out of the screen aborts a waiting write step.
  useEffect(() => wizard.cancel, [wizard.cancel]);

  return (
    <Screen>
      <Text style={[typography.title, { color: colors.text }]}>{strings.wizard.title}</Text>
      {wizard.writtenCount > 0 && (
        <Chip label={fill(strings.wizard.writtenCount, { count: wizard.writtenCount })} />
      )}
      <PhaseView
        phase={wizard.phase}
        wizard={wizard}
        onFinish={() => navigation.goBack()}
      />
      <DevTagButtons phase={wizard.phase} />
    </Screen>
  );
}

function PhaseView({
  phase,
  wizard,
  onFinish,
}: {
  phase: WizardPhase;
  wizard: ReturnType<typeof useBoxWizard>;
  onFinish: () => void;
}) {
  switch (phase.step) {
    case 'details':
      return <DetailsStep onSubmit={(l, o) => void wizard.submitDetails(l, o)} />;
    case 'write':
      return (
        <WriteStep
          tag={phase.tag}
          onWrite={wizard.confirmWrite}
          onRetry={wizard.retryWrite}
        />
      );
    case 'lock-question':
      return <LockDialog onAnswer={wizard.answerLock} />;
    case 'locking':
      return <BusyCard text={strings.wizard.locking} />;
    case 'lock-error':
      return (
        <Card style={styles.centerCard}>
          <StatusText text={strings.wizard.lockFailed} tone="danger" />
          <Button
            label={strings.common.ok}
            variant="secondary"
            onPress={wizard.acceptUnlocked}
          />
        </Card>
      );
    case 'another':
      return (
        <AnotherTagStep
          lastTagLocked={phase.lastTagLocked}
          onAnother={wizard.writeAnotherTag}
          onFinish={() => {
            wizard.cancel();
            onFinish();
          }}
        />
      );
  }
}

function DetailsStep({ onSubmit }: { onSubmit: (label: string, location: string) => void }) {
  const { colors } = useTheme();
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  return (
    <Card>
      <Text style={[typography.heading, { color: colors.text }]}>
        {strings.wizard.detailsHeading}
      </Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {strings.wizard.detailsHint}
      </Text>
      <Field
        label={strings.boxes.labelField}
        value={label}
        onChangeText={setLabel}
        placeholder={strings.wizard.labelPlaceholder}
        autoFocus
      />
      <Field
        label={strings.boxes.locationField}
        value={location}
        onChangeText={setLocation}
        placeholder={strings.wizard.locationPlaceholder}
      />
      <Button
        label={strings.wizard.createAndWrite}
        disabled={label.trim().length === 0}
        onPress={() => onSubmit(label, location)}
      />
    </Card>
  );
}

function WriteStep({
  tag,
  onWrite,
  onRetry,
}: {
  tag: Extract<WizardPhase, { step: 'write' }>['tag'];
  onWrite: () => void;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.centerCard}>
      <Text style={[typography.heading, { color: colors.text }]}>
        {strings.wizard.writeHeading}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.wizard.writeHint}
      </Text>

      {tag.kind === 'waiting' && <BusyInline text={strings.wizard.tagWaiting} />}
      {tag.kind === 'writing' && <BusyInline text={strings.wizard.writing} />}
      {tag.kind === 'error' && (
        <>
          <StatusText text={ERROR_TEXT[tag.error]} tone="danger" />
          <Button label={strings.wizard.retry} variant="secondary" onPress={onRetry} />
        </>
      )}
      {tag.kind === 'detected' && <DetectedTag state={tag.state} onWrite={onWrite} />}
    </Card>
  );
}

function DetectedTag({ state, onWrite }: { state: TagState; onWrite: () => void }) {
  const { colors } = useTheme();
  switch (state.kind) {
    case 'blank':
      return (
        <>
          <StatusText text={strings.wizard.tagBlank} tone="positive" />
          <Button label={strings.wizard.writeButton} onPress={onWrite} />
        </>
      );
    case 'ours':
      return (
        <>
          <StatusText text={strings.wizard.tagOurs} tone="neutral" />
          <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
            {strings.wizard.tagOursHint}
          </Text>
          <Button label={strings.wizard.writeButton} onPress={onWrite} />
        </>
      );
    case 'foreign':
      return (
        <>
          <StatusText text={strings.wizard.tagForeign} tone="danger" />
          <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
            „{state.summary}“
          </Text>
          <Text style={[typography.caption, styles.centered, { color: colors.danger }]}>
            {strings.wizard.tagForeignWarn}
          </Text>
          <Button label={strings.wizard.overwriteButton} variant="danger" onPress={onWrite} />
        </>
      );
    case 'locked-foreign':
      return <StatusText text={strings.wizard.tagLockedForeign} tone="danger" />;
  }
}

/** §9.4 — explicit, default NO, irreversibility spelled out. */
function LockDialog({ onAnswer }: { onAnswer: (lock: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.centerCard}>
      <StatusText text={strings.wizard.writeVerified} tone="positive" />
      <Text style={[typography.heading, styles.centered, { color: colors.text }]}>
        {strings.wizard.lockQuestion}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.wizard.lockWarning}
      </Text>
      {/* Default = NOT locking: the primary, first action declines. */}
      <Button label={strings.wizard.lockDecline} onPress={() => onAnswer(false)} />
      <Button
        label={strings.wizard.lockConfirm}
        variant="ghost"
        onPress={() => onAnswer(true)}
      />
    </Card>
  );
}

function AnotherTagStep({
  lastTagLocked,
  onAnother,
  onFinish,
}: {
  lastTagLocked: boolean;
  onAnother: () => void;
  onFinish: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.centerCard}>
      {lastTagLocked && <StatusText text={strings.wizard.locked} tone="positive" />}
      <Text style={[typography.heading, styles.centered, { color: colors.text }]}>
        {strings.wizard.anotherTagQuestion}
      </Text>
      <Text style={[typography.caption, styles.centered, { color: colors.textMuted }]}>
        {strings.wizard.anotherTagHint}
      </Text>
      <Button label={strings.wizard.anotherTagYes} variant="secondary" onPress={onAnother} />
      <Button label={strings.wizard.finish} onPress={onFinish} />
    </Card>
  );
}

function BusyCard({ text }: { text: string }) {
  return (
    <Card style={styles.centerCard}>
      <BusyInline text={text} />
    </Card>
  );
}

function BusyInline({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.busyRow}>
      <ActivityIndicator color={colors.textMuted} />
      <Text style={[typography.body, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

function StatusText({
  text,
  tone,
}: {
  text: string;
  tone: 'positive' | 'danger' | 'neutral';
}) {
  const { colors } = useTheme();
  const color =
    tone === 'positive' ? colors.positive : tone === 'danger' ? colors.danger : colors.text;
  return (
    <Text style={[typography.body, styles.centered, { color, fontWeight: '600' }]}>{text}</Text>
  );
}

/**
 * DEV-only helpers: the emulator has no NFC, so the FakeTagWriter needs a tag
 * "presented" while the wizard waits. Rendered only in debug builds and only
 * while a write step is waiting for a tag.
 */
function DevTagButtons({ phase }: { phase: WizardPhase }) {
  const { dev } = useAppServices();
  const { colors } = useTheme();
  const waiting =
    (phase.step === 'write' && phase.tag.kind === 'waiting') || phase.step === 'locking';
  if (dev === undefined || !waiting) return null;
  return (
    <Card>
      <Text style={[typography.caption, { color: colors.textFaint }]}>
        {strings.dev.tagPresentHeading}
      </Text>
      <View style={styles.devRow}>
        <Button
          label={strings.dev.presentBlank}
          variant="secondary"
          onPress={() => dev.presentTag('blank')}
        />
        <Button
          label={strings.dev.presentOurs}
          variant="secondary"
          onPress={() => dev.presentTag('ours')}
        />
        <Button
          label={strings.dev.presentForeign}
          variant="secondary"
          onPress={() => dev.presentTag('foreign')}
        />
        <Button
          label={strings.dev.presentLockedForeign}
          variant="secondary"
          onPress={() => dev.presentTag('locked-foreign')}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  centerCard: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  centered: {
    textAlign: 'center',
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  devRow: {
    gap: spacing.sm,
  },
});
