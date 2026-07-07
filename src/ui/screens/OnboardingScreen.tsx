/**
 * Onboarding (BUILD_V1 §11 screen 3) — 4-page pager: the placement ritual
 * (entsperren → Kabel → Box), why charging is the gate, the two permission
 * prompts (real permission calls are J11's — the buttons take callback props
 * and currently no-op), and the §3 transparency notice ("numbers uploaded at
 * seal").
 */
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Button, Card } from '../components/primitives';
import { strings } from '../strings';
import { radius, spacing, typography, useTheme } from '../theme';

export interface OnboardingScreenProps {
  onDone: () => void;
  /** J11 wires the real permission requests; no-ops until then. */
  onRequestNotifications?: () => void;
  onRequestBatteryExemption?: () => void;
}

const PAGE_COUNT = 4;

export function OnboardingScreen({
  onDone,
  onRequestNotifications,
  onRequestBatteryExemption,
}: OnboardingScreenProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.skipRow}>
        {page < PAGE_COUNT - 1 ? (
          <Pressable accessibilityRole="button" onPress={onDone}>
            <Text style={[typography.caption, { color: colors.textFaint }]}>
              {strings.onboarding.skip}
            </Text>
          </Pressable>
        ) : (
          <Text> </Text>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setPage(Math.round(event.nativeEvent.contentOffset.x / width))
        }
      >
        <Page width={width} title={strings.onboarding.page1Title} body={strings.onboarding.page1Body}>
          <Card style={styles.ritualCard}>
            {strings.onboarding.page1Steps.map((step) => (
              <Text key={step} style={[typography.body, { color: colors.text }]}>
                {step}
              </Text>
            ))}
          </Card>
        </Page>

        <Page width={width} title={strings.onboarding.page2Title} body={strings.onboarding.page2Body}>
          <View style={styles.gateIllustration}>
            <View style={[styles.plug, { backgroundColor: colors.day }]} />
            <View style={[styles.cable, { backgroundColor: colors.textFaint }]} />
            <View style={[styles.plug, { backgroundColor: colors.night }]} />
          </View>
        </Page>

        <Page width={width} title={strings.onboarding.page3Title} body={strings.onboarding.page3Body}>
          <View style={styles.permissionButtons}>
            <Button
              label={strings.onboarding.page3NotificationButton}
              variant="secondary"
              onPress={() => onRequestNotifications?.()}
            />
            <Button
              label={strings.onboarding.page3BatteryButton}
              variant="secondary"
              onPress={() => onRequestBatteryExemption?.()}
            />
            <Text style={[typography.caption, styles.centered, { color: colors.textFaint }]}>
              {strings.onboarding.page3Hint}
            </Text>
          </View>
        </Page>

        <Page width={width} title={strings.onboarding.page4Title} body={strings.onboarding.page4Body} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {Array.from({ length: PAGE_COUNT }, (_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { backgroundColor: index === page ? colors.action : colors.border },
              ]}
            />
          ))}
        </View>
        {page < PAGE_COUNT - 1 ? (
          <Button label={strings.common.next} onPress={() => goTo(page + 1)} />
        ) : (
          <Button label={strings.onboarding.startButton} onPress={onDone} />
        )}
      </View>
    </View>
  );
}

function Page({
  width,
  title,
  body,
  children,
}: {
  width: number;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.page, { width }]}>
      <Text style={[typography.title, styles.centered, { color: colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.centered, { color: colors.textMuted }]}>{body}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skipRow: {
    alignItems: 'flex-end',
    padding: spacing.lg,
    paddingTop: spacing.xxl,
  },
  page: {
    padding: spacing.xl,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  ritualCard: {
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  gateIllustration: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    marginVertical: spacing.lg,
  },
  plug: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
  },
  cable: {
    width: 90,
    height: 4,
    borderRadius: 2,
  },
  permissionButtons: {
    gap: spacing.sm,
  },
  footer: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
