/**
 * Shared UI primitives — plain RN + StyleSheet, no external UI kit (JOBS.md J8).
 * Purely presentational; all state and logic stay in hooks/screens.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  if (!scroll) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>{children}</View>
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.screenScrollContent}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[typography.heading, styles.sectionHeader, { color: colors.text }]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const background =
    variant === 'primary'
      ? colors.action
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surfaceAlt
          : 'transparent';
  const textColor =
    variant === 'primary' || variant === 'danger'
      ? colors.onAction
      : variant === 'ghost'
        ? colors.action
        : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[typography.body, { color: textColor, fontWeight: '600' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chips / badges
// ---------------------------------------------------------------------------

export function Chip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'day' | 'night' | 'danger' | 'positive';
}) {
  const { colors } = useTheme();
  const toneColors: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
    day: { bg: colors.dayMuted, fg: colors.text },
    night: { bg: colors.nightMuted, fg: colors.text },
    danger: { bg: colors.surfaceAlt, fg: colors.danger },
    positive: { bg: colors.surfaceAlt, fg: colors.positive },
  };
  const { bg, fg } = toneColors[tone] ?? toneColors.neutral;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[typography.caption, { color: fg, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({
  label,
  ...inputProps
}: { label: string } & TextInputProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.textMuted, marginBottom: spacing.xs }]}>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...inputProps}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceAlt,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
      />
    </View>
  );
}

/** Numeric stepper — used by Settings for hours/seconds tunables. */
export function Stepper({
  value,
  display,
  onDecrement,
  onIncrement,
}: {
  value: number;
  display: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Verringern (aktuell ${value})`}
        onPress={onDecrement}
        style={[styles.stepperButton, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={[typography.heading, { color: colors.text }]}>−</Text>
      </Pressable>
      <Text
        style={[
          typography.body,
          styles.stepperValue,
          { color: colors.text, fontVariant: ['tabular-nums'] },
        ]}
      >
        {display}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Erhöhen (aktuell ${value})`}
        onPress={onIncrement}
        style={[styles.stepperButton, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={[typography.heading, { color: colors.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function EmptyState({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[typography.body, { color: colors.textFaint, textAlign: 'center' }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: spacing.lg,
  },
  screenScrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeader: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
  },
  field: {
    marginBottom: spacing.md,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 72,
    textAlign: 'center',
    fontWeight: '600',
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
});
