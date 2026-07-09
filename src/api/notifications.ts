/**
 * notifications — thin wrapper over @notifee/react-native for the
 * "reply ready" notification we post when the agent finishes a turn.
 *
 * Three things have to happen before any notification can show:
 *
 *   1. POST_NOTIFICATIONS must be granted at runtime (Android 13+). The OS
 *      silently drops notifications otherwise.
 *   2. A channel must exist (Android 8+). Notifee's createChannel() is the
 *      canonical way to do that and it's idempotent.
 *   3. The app must have been launched at least once so the native side has
 *      initialised — handled implicitly by the call site (App.tsx → Shell
 *      mount → ensureNotificationSetup()).
 *
 * Notifee is lazy-required inside try/catch (matching audioBridge.ts's
 * pattern) so the app still loads if the native module isn't linked yet —
 * callers get a `false` return and skip the notif.
 *
 * @notifee/react-native 7.x adds these at compile time; the doc comment at
 * the top of file describes the runtime contract.
 */
import {Platform} from 'react-native';
import {requestCapability} from './permissions';

let _notifee: any = null;
let _notifeeTried = false;

function getNotifee(): any | null {
  if (_notifeeTried) return _notifee;
  _notifeeTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@notifee/react-native');
    _notifee = mod.default ?? mod;
  } catch {
    _notifee = null;
  }
  return _notifee;
}

export const REPLY_READY_CHANNEL_ID = 'hermes-replies';
export const REPLY_READY_CHANNEL_NAME = 'Agent replies';

/** True when the native module is linked and a channel can be created. */
export function isNotificationAvailable(): boolean {
  return !!getNotifee();
}

/**
 * One-shot bootstrap: ask for POST_NOTIFICATIONS on Android 13+, create
 * the channel on Android 8+, and stash the channel id for later use.
 * Safe to call repeatedly; notifee's createChannel is a no-op if the
 * channel already exists.
 *
 * Returns `{available, granted, channelId}` so the caller can decide what
 * to show in the UI when, e.g., the user has denied the permission.
 */
export async function ensureNotificationSetup(): Promise<{
  available: boolean;
  granted: boolean;
  channelId: string | null;
}> {
  const notifee = getNotifee();
  if (!notifee) return {available: false, granted: false, channelId: null};

  // Runtime permission for Android 13+ — `notifications` row maps to
  // POST_NOTIFICATIONS. On older Android / iOS this is a no-op.
  const granted = await requestCapability('notifications');

  let channelId: string | null = null;
  if (Platform.OS === 'android') {
    try {
      channelId = await notifee.createChannel({
        id: REPLY_READY_CHANNEL_ID,
        name: REPLY_READY_CHANNEL_NAME,
        description: 'Notifications posted when the agent finishes a reply.',
        importance: 4, // IMPORTANCE_HIGH — shows as heads-up
      });
    } catch {
      channelId = null;
    }
  }

  return {available: true, granted, channelId};
}

/**
 * Post a "Hermes finished a reply" notification. Tap deep-links to the
 * chat screen for the given session.
 *
 * `previewText` is the agent's first ~120 chars — surfaced in the
 * notification body for at-a-glance reading. `engineLabel` is included
 * in the title so the user can tell whether the desktop or the cloud
 * engine answered.
 *
 * Returns `true` if a notification was posted, `false` if it was suppressed
 * (no perm / no channel / native module missing).
 */
export async function notifyReplyReady(opts: {
  sessionId: string;
  sessionTitle?: string | null;
  previewText: string;
  engineLabel?: string;
  deepLinkScreen?: string;
}): Promise<boolean> {
  const notifee = getNotifee();
  if (!notifee) return false;

  // Don't double-post: if the same session id already has a live notif
  // visible, replace it instead of stacking.
  const existing = await notifee.getDisplayedNotifications?.().catch(() => []);
  const tag = `reply-${opts.sessionId}`;
  const dupe = Array.isArray(existing)
    ? existing.find((n: any) => n?.notification?.data?.tag === tag)
    : null;

  const bodyPreview = (opts.previewText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  const notification: any = {
    id: dupe?.id ?? undefined, // undefined → notifee auto-assigns one
    title: opts.sessionTitle
      ? `${opts.sessionTitle.toUpperCase()} · ${opts.engineLabel ?? 'Hermes'}`
      : `Hermes · ${opts.engineLabel ?? 'reply ready'}`,
    body: bodyPreview || 'Reply ready.',
    data: {
      tag,
      screen: opts.deepLinkScreen ?? 'chat',
      sessionId: opts.sessionId,
    },
    android: {
      channelId: REPLY_READY_CHANNEL_ID,
      smallIcon: 'ic_launcher',
      pressAction: {id: 'default'},
      autoCancel: true,
      // Show only if the user isn't actively in the chat screen for this
      // session. We can't perfectly detect "user is staring at the chat
      // already" — best-effort is to only NOT post if the chat screen is
      // already mounted (see notifyReplyReadyIfBackgrounded).
    },
  };

  try {
    await notifee.displayNotification(notification);
    return true;
  } catch {
    return false;
  }
}

/**
 * Same as notifyReplyReady, but guarded: returns `false` (no-op) if the
 * app is currently foregrounded and the user is looking at the chat for
 * this session. Notifee can't introspect React's mounted state, so the
 * caller passes a flag (computed by AppContext based on screen + session).
 */
export async function notifyReplyReadyIfBackgrounded(
  opts: Parameters<typeof notifyReplyReady>[0] & {suppressed?: boolean},
): Promise<boolean> {
  if (opts.suppressed) return false;
  const {suppressed, ...rest} = opts;
  return notifyReplyReady(rest);
}

/**
 * Wire notifee's tap events to a host-supplied handler. The handler
 * receives `{screen, sessionId}` so callers can route into ChatScreen.
 * `onForegroundEvent` fires when the user taps a notif while the app
 * is open; `onBackgroundEvent` fires when the app is killed/backgrounded
 * and notifee deep-launches us.
 *
 * Call this once from <App.tsx> after the providers are mounted. The
 * returned function unsubscribes both event sources.
 */
export function subscribeNotificationTaps(
  handler: (payload: {screen?: string; sessionId?: string; tag?: string}) => void,
): () => void {
  const notifee = getNotifee();
  if (!notifee) return () => {};
  const routeTap = (event: any) => {
    // PRESS events are the user-tap. DELIVERED is just "the OS showed it".
    if (event?.type !== 1 /* PRESS */) return;
    const data = event?.detail?.notification?.data ?? {};
    if (typeof data?.screen === 'string' || typeof data?.sessionId === 'string') {
      handler({screen: data.screen, sessionId: data.sessionId, tag: data.tag});
    }
  };
  const fwd = notifee.onForegroundEvent(routeTap);
  const bwd = notifee.onBackgroundEvent(routeTap);
  return () => {
    try { fwd?.(); } catch {}
    try { bwd?.(); } catch {}
  };
}
