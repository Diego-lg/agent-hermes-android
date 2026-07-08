/**
 * YOLO mode capability registry + helpers.
 *
 * "Independent mode" / YOLO = the app's mobile-cloud engine is allowed to use
 * every on-device capability (internet to model APIs, camera, mic, location,
 * files, photos, contacts, calendar, notifications, etc.). The user can
 * flip the master YOLO switch off, or toggle individual capabilities.
 *
 * This file:
 *   - declares the canonical capability list (single source of truth)
 *   - maps each capability to its Android permission(s)
 *   - offers runtime helpers (`getGranted`, `request`) that wrap the
 *     PermissionsAndroid JS API and degrade gracefully on iOS / jest
 *
 * Adding a new capability here auto-renders a row in the Settings YOLO
 * section and the Home / Chat status banner.
 */
import {Platform, PermissionsAndroid} from 'react-native';

/**
 * A user-facing capability the app may need. Order matters — it drives
 * the on-screen list, so put the most visible first.
 */
export type CapabilityId =
  | 'internet'
  | 'files'
  | 'photos'
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'contacts'
  | 'calendar'
  | 'phone';

export interface Capability {
  id: CapabilityId;
  /** One-line summary shown in the toggle row. */
  label: string;
  /** Longer description, shown under the row. */
  description: string;
  /** Android permission strings. iOS keys can be added later if we ship iOS. */
  androidPermissions?: string[];
  /** Granted at install time if listed in AndroidManifest.xml under "normal" protection. */
  installGranted?: boolean;
  /** Capability the runtime may need to flip on a settings screen even when granted. */
  requiresServicePrompt?: boolean;
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'internet',
    label: 'Internet',
    description: 'Reach cloud model APIs (MiniMax, OpenAI, Anthropic, etc). Always on in YOLO.',
    installGranted: true, // normal protection — granted at install
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Read documents from device storage (PDF, txt, code, etc).',
    // READ_EXTERNAL_STORAGE is gone on API 33+; we use the scoped SAF flow
    // via react-native-document-picker, which the user grants per-file.
    // We still request READ_MEDIA on API 33+ to browse images broadly.
    androidPermissions: Platform.select({
      android: ['android.permission.READ_EXTERNAL_STORAGE'],
      default: undefined,
    }) as string[] | undefined,
  },
  {
    id: 'photos',
    label: 'Photos & images',
    description: 'Read images from gallery. On Android 13+ uses READ_MEDIA_IMAGES.',
    androidPermissions: Platform.select({
      android: ['android.permission.READ_MEDIA_IMAGES'],
      default: undefined,
    }) as string[] | undefined,
  },
  {
    id: 'camera',
    label: 'Camera',
    description: 'Take a photo and attach it to a message.',
    androidPermissions: ['android.permission.CAMERA'],
  },
  {
    id: 'microphone',
    label: 'Microphone',
    description: 'Voice input for hands-free chat.',
    androidPermissions: ['android.permission.RECORD_AUDIO'],
  },
  {
    id: 'location',
    label: 'Location',
    description: "Share the phone's location with the agent when asked.",
    androidPermissions: ['android.permission.ACCESS_FINE_LOCATION'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Background alerts when the agent finishes a long task.',
    androidPermissions: ['android.permission.POST_NOTIFICATIONS'],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    description: 'Look up a contact when you ask "email Alice".',
    androidPermissions: Platform.select({
      android: ['android.permission.READ_CONTACTS'],
      default: undefined,
    }) as string[] | undefined,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Add events the agent suggests.',
    androidPermissions: Platform.select({
      android: ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'],
      default: undefined,
    }) as string[] | undefined,
  },
  {
    id: 'phone',
    label: 'Phone',
    description: 'Place calls when the agent dials for you.',
    androidPermissions: ['android.permission.CALL_PHONE'],
  },
];

const BY_ID: Record<CapabilityId, Capability> = (() => {
  const m = {} as Record<CapabilityId, Capability>;
  for (const c of CAPABILITIES) m[c.id] = c;
  return m;
})();

export function getCapability(id: CapabilityId): Capability {
  return BY_ID[id];
}

/** Default YOLO capability set when the user enables YOLO. */
export const YOLO_DEFAULT_ENABLED: CapabilityId[] = CAPABILITIES.map(c => c.id);

/**
 * Default per-capability map used when no per-capability preference is
 * persisted yet. Each entry is `true` (YOLO: grant everything) so the
 * "independent mode" feel matches what the user asked for.
 */
export function defaultCapabilityMap(): Record<CapabilityId, boolean> {
  const m = {} as Record<CapabilityId, boolean>;
  for (const c of CAPABILITIES) {
    // 'internet' is always on — there's no toggle for it.
    m[c.id] = c.id === 'internet' ? true : true;
  }
  return m;
}

/**
 * Request all listed Android permissions in one shot. Returns a map
 * `id -> granted`. If a permission can't even be requested (iOS, jest,
 * missing perm string), it's reported as `true` for that one capability
 * so the UI doesn't show false negatives.
 */
export async function requestCapability(id: CapabilityId): Promise<boolean> {
  const cap = BY_ID[id];
  if (!cap?.androidPermissions?.length) return true;
  if (Platform.OS !== 'android') return true;
  try {
    // PermissionsAndroid.requestMultiple accepts the underlying enum on
    // recent RN versions, but the JS layer accepts raw perm strings too —
    // cast to any to stay portable across RN patch levels.
    const res = await (PermissionsAndroid.requestMultiple as any)(cap.androidPermissions);
    // On API 33+, requesting READ_EXTERNAL_STORAGE for `id === 'files'`
    // might never resolve because it's denied in the manifest. In that
    // case the OS returns 'denied' for every perm — that's a real NO.
    for (const p of cap.androidPermissions) {
      const v = (res as any)[p];
      if (v !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Request every YOLO capability in parallel. Returns granted map. */
export async function requestAll(): Promise<Record<CapabilityId, boolean>> {
  const out = {} as Record<CapabilityId, boolean>;
  await Promise.all(
    CAPABILITIES.map(async c => {
      out[c.id] = await requestCapability(c.id);
    }),
  );
  return out;
}

/**
 * Return which permissions the user has actually granted the app right
 * now (regardless of the user's app-level toggle). Useful to colour the
 * YOLO screen green (granted) vs orange (not granted).
 */
export async function getGrantedMap(): Promise<Record<CapabilityId, boolean>> {
  const out = {} as Record<CapabilityId, boolean>;
  for (const c of CAPABILITIES) {
    if (c.installGranted || !c.androidPermissions?.length) {
      out[c.id] = true;
      continue;
    }
    if (Platform.OS !== 'android') {
      out[c.id] = true;
      continue;
    }
    // For installs older than the runtime we can't know the version, so
    // we attempt the check and treat failures as "not yet granted".
    try {
      let granted = true;
      for (const p of c.androidPermissions) {
        // PermissionsAndroid.check() is typed as expecting the
        // Permission enum, but the JS implementation accepts the raw
        // permission string — cast through `any` to avoid a
        // generic-versioned type that differs across RN patch releases.
        const ok = await (PermissionsAndroid.check as any)(p);
        if (!ok) { granted = false; break; }
      }
      out[c.id] = granted;
    } catch {
      out[c.id] = false;
    }
  }
  return out;
}
