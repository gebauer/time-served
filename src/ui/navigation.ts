/**
 * Navigation param lists — shared types between screens (ui/) and the
 * navigators (src/app/App.tsx). Types only; the navigator components live in
 * the composition root.
 */
import type { GroupId } from '../domain/types';

export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: undefined;
  BoxWizard: undefined;
  GroupCreate: undefined;
  GroupJoin: { inviteUrl?: string } | undefined;
  Leaderboard: { groupId: GroupId; groupName: string };
  DevHarness: undefined;
};

export type TabsParamList = {
  Home: undefined;
  Verlauf: undefined;
  Boxen: undefined;
  Gruppen: undefined;
  Einstellungen: undefined;
};
