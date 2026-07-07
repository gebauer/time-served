/**
 * Invite deep links (BUILD_V1 §10.4, JOBS.md J10) — routes both link forms to
 * the GroupJoin screen:
 *
 *   https://<host>/j#g=<group_id>&k=<K_g b64url>   (universal link)
 *   timeserved://j#g=…&k=…                          (scheme deep link)
 *
 * The group key K_g sits in the URL FRAGMENT: expo-linking hands us the full
 * string; the fragment never reached any server. We deliberately do NOT use
 * React Navigation's `linking` config — it maps paths, but the payload here
 * is the fragment, which must reach GroupJoinScreen verbatim as `inviteUrl`.
 *
 * This module imports expo-linking and is only pulled in from App.tsx.
 */
import * as Linking from 'expo-linking';

export interface InviteDeepLinkDeps {
  /** GroupsGateway.parseInvite — decides whether a URL is an invite. */
  readonly parseInvite: (url: string) => unknown | undefined;
  /** Called with the raw invite URL (navigate to GroupJoin with it). */
  readonly onInvite: (inviteUrl: string) => void;
}

/** Handles the cold-start URL + runtime URL events. Returns a detach fn. */
export function attachInviteDeepLinks(deps: InviteDeepLinkDeps): () => void {
  let detached = false;

  function handle(url: string | null): void {
    if (detached || url === null) return;
    if (deps.parseInvite(url) !== undefined) deps.onInvite(url);
  }

  void Linking.getInitialURL().then(handle, () => undefined);
  const subscription = Linking.addEventListener('url', (event) => handle(event.url));

  return () => {
    detached = true;
    subscription.remove();
  };
}
