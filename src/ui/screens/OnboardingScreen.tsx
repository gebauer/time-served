/**
 * Onboarding (BUILD_V1 §11 screen 3) — 4-page pager: the placement ritual
 * (entsperren → Kabel → Box), why charging is the gate, the two REAL permission
 * prompts (J11: POST_NOTIFICATIONS + battery-optimization exemption over the
 * SystemStatusService seam, both optional — denial degrades visibility, never
 * counting), and the §3 transparency notice ("numbers uploaded at seal").
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

import { Button, Card, Chip } from '../components/primitives';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { strings } from '../strings';
import { radius, spacing, typography, useTheme } from '../theme';

export interface OnboardingScreenProps {
  onDone: () => void;
}

const PAGE_COUNT = 4;

export function OnboardingScreen({ onDone }: OnboardingScreenProps) {
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
          <PermissionsStep />
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

/**
 * The two J11 permission requests. Both dialogs resolve outside the app;
 * useSystemStatus re-reads the states on every refocus. Denial is handled
 * honestly: a caption explains the (small) consequence + the app-settings
 * escape hatch — onboarding never blocks on either permission.
 */
function PermissionsStep() {
  const { colors } = useTheme();
  const status = useSystemStatus();
  // "Asked and still denied" — only then show the denial hint (a user who
  // simply has not tapped yet should not read like a denial).
  const [notifAsked, setNotifAsked] = useState(false);

  return (
    <View style={styles.permissionButtons}>
      {status.notifications === 'granted' ? (
        <Chip label={`${strings.onboarding.page3NotificationButton}: ${strings.onboarding.page3Granted}`} tone="positive" />
      ) : (
        <Button
          label={strings.onboarding.page3NotificationButton}
          variant="secondary"
          disabled={status.notifications === undefined}
          onPress={() => {
            setNotifAsked(true);
            void status.requestNotifications();
          }}
        />
      )}
      {notifAsked && status.notifications === 'denied' && (
        <>
          <Text style={[typography.caption, styles.centered, { color: colors.textFaint }]}>
            {strings.onboarding.page3NotificationDenied}
          </Text>
          <Button
            label={strings.settings.openAppSettings}
            variant="ghost"
            onPress={status.openAppSettings}
          />
        </>
      )}

      {status.battery === 'granted' ? (
        <Chip label={`${strings.onboarding.page3BatteryButton}: ${strings.onboarding.page3Granted}`} tone="positive" />
      ) : status.battery === 'unavailable' ? (
        <Text style={[typography.caption, styles.centered, { color: colors.textFaint }]}>
          {strings.settings.batteryOptUnavailable}
        </Text>
      ) : (
        <>
          <Button
            label={strings.onboarding.page3BatteryButton}
            variant="secondary"
            disabled={status.battery === undefined}
            onPress={() => void status.requestBattery()}
          />
          {/* §8.5 framing — why this exemption exists. */}
          <Text style={[typography.caption, styles.centered, { color: colors.textFaint }]}>
            {strings.onboarding.page3BatteryHint}
          </Text>
        </>
      )}
      <Text style={[typography.caption, styles.centered, { color: colors.textFaint }]}>
        {strings.onboarding.page3Hint}
      </Text>
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
