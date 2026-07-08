/**
 * Notes store — local cache + cloud sync.
 *
 * The source of truth is Google Drive. We keep a local mirror in
 * AsyncStorage so the list renders instantly when the app opens,
 * then refresh from Drive in the background.
 */
import {kv, STORAGE_KEYS} from './storage';
import {GoogleDriveClient, DriveFile, DriveConfig} from './googleDrive';

export interface NoteMeta extends DriveFile {
  /** Cached first line of the note, for the list view. */
  preview?: string;
  /** ISO timestamp, ms since epoch. */
  modifiedMs: number;
}

export interface NoteContent {
  id: string;
  name: string;
  content: string;
  modifiedMs: number;
}

export class NotesStore {
  private client: GoogleDriveClient | null = null;
  private config: DriveConfig | null = null;

  setConfig(cfg: DriveConfig) {
    this.config = cfg;
    this.client = new GoogleDriveClient(cfg);
  }

  hasConfig(): boolean {
    return !!this.config && !!this.config.clientId;
  }

  isAuthorized(): boolean {
    return !!this.client?.isAuthorized();
  }

  client_(): GoogleDriveClient {
    if (!this.client) throw new Error('Drive config not set');
    return this.client;
  }

  /** Persist drive config (clientId, redirectUrl). */
  async saveConfig(cfg: DriveConfig): Promise<void> {
    this.setConfig(cfg);
    await kv.setItem(STORAGE_KEYS.driveConfig, JSON.stringify(cfg));
  }

  /** Load drive config from storage. */
  async loadConfig(): Promise<DriveConfig | null> {
    const raw = await kv.getItem(STORAGE_KEYS.driveConfig);
    if (!raw) return null;
    try {
      const cfg = JSON.parse(raw) as DriveConfig;
      this.setConfig(cfg);
      return cfg;
    } catch {
      return null;
    }
  }

  /** Restore OAuth tokens. Returns true if signed in. */
  async restore(): Promise<boolean> {
    if (!this.client) return false;
    return this.client.restore();
  }

  /** Trigger OAuth flow. */
  async authorize(): Promise<void> {
    return this.client_().authorize();
  }

  async signOut(): Promise<void> {
    return this.client_().signOut();
  }

  /** User profile, for "Signed in as X" UI. */
  async me(): Promise<{email: string; name: string}> {
    return this.client_().me();
  }

  /* ---------- List / read / write ---------- */

  async list(): Promise<NoteMeta[]> {
    const files = await this.client_().listNotes();
    return files.map(f => ({
      ...f,
      modifiedMs: new Date(f.modifiedTime).getTime(),
    }));
  }

  async read(id: string): Promise<NoteContent> {
    const files = await this.client_().listNotes();
    const meta = files.find(f => f.id === id);
    if (!meta) throw new Error('Note not found in Drive');
    const content = await this.client_().readFile(id);
    return {
      id: meta.id,
      name: meta.name.replace(/\.md$/, ''),
      content,
      modifiedMs: new Date(meta.modifiedTime).getTime(),
    };
  }

  async write(name: string, content: string, existingId?: string): Promise<NoteContent> {
    const id = await this.client_().writeFile(name, content, existingId);
    return {
      id,
      name: name.replace(/\.md$/, ''),
      content,
      modifiedMs: Date.now(),
    };
  }

  async delete(id: string): Promise<void> {
    return this.client_().deleteFile(id);
  }
}

export const notesStore = new NotesStore();
