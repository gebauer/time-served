/**
 * App root (CLAUDE.md §6) — bootstraps the AppServices composition root
 * (services.ts, the J9/J10 swap surface), gates on onboarding, and hosts the
 * navigation tree: bottom tabs (Home, Verlauf, Boxen, Gruppen, Einstellungen)
 * plus root-stack flows (Box-Wizard, Gruppe erstellen/beitreten, Rangliste,
 * Dev-Harness).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, useColorScheme, View } from 'react-native';
import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import type { RootStackParamList, TabsParamList } from '../ui/navigation';
import { BoxesScreen } from '../ui/screens/BoxesScreen';
import { BoxWizardScreen } from '../ui/screens/BoxWizardScreen';
import { DevHarnessScreen } from '../ui/screens/DevHarnessScreen';
import { GroupCreateScreen } from '../ui/screens/GroupCreateScreen';
import { GroupJoinScreen } from '../ui/screens/GroupJoinScreen';
import { GroupsScreen } from '../ui/screens/GroupsScreen';
import { HistoryScreen } from '../ui/screens/HistoryScreen';
import { HomeScreen } from '../ui/screens/HomeScreen';
import { LeaderboardScreen } from '../ui/screens/LeaderboardScreen';
import { OnboardingScreen } from '../ui/screens/OnboardingScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import {
  AppServicesContext,
  type AppServices,
} from '../ui/services/AppServicesContext';
import { strings } from '../ui/strings';
import { darkPalette, lightPalette } from '../ui/theme';
import { createAppServices } from './services';
// J10: invite deep links (timeserved:// + https universal links) → GroupJoin.
import { attachInviteDeepLinks } from './sync/inviteDeepLink';

const Tab = createBottomTabNavigator<TabsParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const [services, setServices] = useState<AppServices | undefined>(undefined);
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? darkPalette : lightPalette;

  useEffect(() => {
    void createAppServices().then(async (created) => {
      const done = await created.onboarding.isDone();
      setOnboarded(done);
      setServices(created);
    });
  }, []);

  // J10: route invite links to the GroupJoin screen. Links arriving before
  // navigation is ready (cold start, onboarding) are parked and flushed via
  // the container's onReady below.
  //
  // STARTUP ORDER vs. J9's bootstrap: this effect only runs once `services`
  // resolves, i.e. AFTER createAppServices completed the launch APP_RESUMED
  // reconciliation, the NDEF launch-tag drain and the J10 sync bootstrap —
  // an invite can therefore never race the session-loop startup. A cold start
  // BY TAG delivers the tag URI (timeserved://box/…) as the initial URL too;
  // parseInvite() rejects it (not an invite), so the two launch paths cannot
  // cross-fire: the tag intent is handled by AndroidTagReader.emitLaunchTag,
  // invite URLs by this handler.
  const pendingInviteRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (services === undefined) return;
    return attachInviteDeepLinks({
      parseInvite: (url) => services.groups.parseInvite(url),
      onInvite: (inviteUrl) => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('GroupJoin', { inviteUrl });
        } else {
          pendingInviteRef.current = inviteUrl;
        }
      },
    });
  }, [services]);

  const navigationTheme: NavigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.action,
        background: palette.background,
        card: palette.surface,
        text: palette.text,
        border: palette.border,
      },
    };
  }, [scheme, palette]);

  if (services === undefined || onboarded === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.background,
          gap: 12,
        }}
      >
        <ActivityIndicator color={palette.textMuted} />
        <Text style={{ color: palette.textMuted }}>{strings.common.loading}</Text>
      </View>
    );
  }

  return (
    <AppServicesContext.Provider value={services}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {onboarded ? (
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          onReady={() => {
            const inviteUrl = pendingInviteRef.current;
            if (inviteUrl !== undefined) {
              pendingInviteRef.current = undefined;
              navigationRef.navigate('GroupJoin', { inviteUrl });
            }
          }}
        >
          <RootStack />
        </NavigationContainer>
      ) : (
        <OnboardingScreen
          onDone={() => {
            void services.onboarding.markDone();
            setOnboarded(true);
          }}
          // J11 wires the real permission requests.
          onRequestNotifications={() => {}}
          onRequestBatteryExemption={() => {}}
        />
      )}
    </AppServicesContext.Provider>
  );
}

function RootStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="BoxWizard"
        component={BoxWizardScreen}
        options={{ title: strings.wizard.title, presentation: 'modal' }}
      />
      <Stack.Screen
        name="GroupCreate"
        component={GroupCreateScreen}
        options={{ title: strings.groups.createTitle, presentation: 'modal' }}
      />
      <Stack.Screen
        name="GroupJoin"
        component={GroupJoinScreen}
        options={{ title: strings.groups.joinTitle, presentation: 'modal' }}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={({ route }) => ({ title: route.params.groupName })}
      />
      <Stack.Screen
        name="DevHarness"
        component={DevHarnessScreen}
        options={{ title: strings.dev.title }}
      />
    </Stack.Navigator>
  );
}

const TAB_GLYPHS: Record<keyof TabsParamList, string> = {
  Home: '⌂',
  Verlauf: '◔',
  Boxen: '▣',
  Gruppen: '◎',
  Einstellungen: '⚙',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 19, lineHeight: 24 }}>
            {TAB_GLYPHS[route.name]}
          </Text>
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: strings.tabs.home, headerShown: false }}
      />
      <Tab.Screen
        name="Verlauf"
        component={HistoryScreen}
        options={{ title: strings.tabs.history }}
      />
      <Tab.Screen
        name="Boxen"
        component={BoxesScreen}
        options={{ title: strings.tabs.boxes }}
      />
      <Tab.Screen
        name="Gruppen"
        component={GroupsScreen}
        options={{ title: strings.tabs.groups }}
      />
      <Tab.Screen
        name="Einstellungen"
        component={SettingsScreen}
        options={{ title: strings.tabs.settings }}
      />
    </Tab.Navigator>
  );
}
