/**
 * Google Drive client (OAuth + REST wrapper).
 *
 * Uses `react-native-app-auth` for the OAuth 2.0 PKCE flow. Once authorised,
 * we keep a refresh token in the user's Google account that grants
 * `https://www.googleapis.com/auth/drive.file` scope — i.e. access only to
 * files the app creates, not the user's whole Drive. That keeps the trust
 * surface small.
 *
 * All REST calls are plain `fetch` against `https://www.googleapis.com/drive/v3`.
 * Files are markdown, so the upload mime type is `text/markdown`.
 *
 * To set this up:
 *   1. Create a project at console.cloud.google.com
 *   2. Enable the Google Drive API
 *   3. Create OAuth 2.0 Client ID (Android, package = com.diego.androidhermes)
 *   4. Add the SHA-1 fingerprint of your debug keystore
 *   5. Drop the Client ID into Settings → Cloud → Google Drive on the phone
 */
import * as AppAuth from 'react-native-app-auth';
import {kv, STORAGE_KEYS} from './storage';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveConfig {
  clientId: string;
  redirectUrl: string;          // com.diego.androidhermes:/oauth
  folderId?: string;            // Drive folder ID where notes live
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export class GoogleDriveClient {
  private cfg: DriveConfig;
  private accessToken: string | null = null;
  private accessTokenExp = 0;
  private refreshToken: string | null = null;

  constructor(cfg: DriveConfig) {
    this.cfg = cfg;
  }

  /** Build the AuthConfiguration that the lib expects. */
  private authConfig(): any {
    return {
      issuer: 'https://accounts.google.com',
      clientId: this.cfg.clientId,
      redirectUrl: this.cfg.redirectUrl,
      scopes: [DRIVE_FILE_SCOPE],
      usePKCE: true,
    };
  }

  /* ---------- Auth ---------- */

  isAuthorized(): boolean {
    return !!this.refreshToken;
  }

  /** Kick off the OAuth 2.0 PKCE flow. Returns once the user has granted access. */
  async authorize(): Promise<void> {
    const result = await AppAuth.authorize(this.authConfig());
    this.accessToken = result.accessToken;
    // v6.4.3 returns accessTokenExpirationDate as an ISO string.
    this.accessTokenExp = result.accessTokenExpirationDate
      ? Date.parse(result.accessTokenExpirationDate) - 60_000
      : Date.now() + 3500_000;
    this.refreshToken = result.refreshToken ?? this.refreshToken;
    await this.persist();
  }

  /** Sign out — forget tokens. */
  async signOut(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.accessTokenExp = 0;
    await this.persist();
  }

  /** Restore tokens from AsyncStorage. Called once at boot. */
  async restore(): Promise<boolean> {
    const raw = await kv.getItem(STORAGE_KEYS.driveTokens);
    if (!raw) return false;
    try {
      const t = JSON.parse(raw);
      this.accessToken = t.accessToken;
      this.refreshToken = t.refreshToken;
      this.accessTokenExp = t.accessTokenExp ?? 0;
      return !!this.refreshToken;
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    await kv.setItem(
      STORAGE_KEYS.driveTokens,
      JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        accessTokenExp: this.accessTokenExp,
      }),
    );
  }

  /** Refresh the access token if it's about to expire. */
  private async ensureFreshToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExp) {
      return this.accessToken;
    }
    if (!this.refreshToken) {
      throw new Error('Not authorized — call authorize() first');
    }
    const result = await AppAuth.refresh(this.authConfig(), {refreshToken: this.refreshToken});
    this.accessToken = result.accessToken;
    this.accessTokenExp = result.accessTokenExpirationDate
      ? Date.parse(result.accessTokenExpirationDate) - 60_000
      : Date.now() + 3500_000;
    if (result.refreshToken) this.refreshToken = result.refreshToken;
    await this.persist();
    return this.accessToken!;
  }

  /* ---------- File ops ---------- */

  /** Ensure the app's notes folder exists in the user's Drive. Returns its id. */
  async ensureNotesFolder(): Promise<string> {
    if (this.cfg.folderId) return this.cfg.folderId;
    const token = await this.ensureFreshToken();
    const q = encodeURIComponent(
      `name='hermes-notes' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const r = await fetch(
      `${DRIVE_API}/files?q=${q}&fields=files(id,name)`,
      {headers: {Authorization: `Bearer ${token}`}},
    );
    if (!r.ok) throw new Error(`Drive list failed: ${r.status}`);
    const j = await r.json();
    if (j.files && j.files.length > 0) {
      this.cfg.folderId = j.files[0].id;
      return j.files[0].id;
    }
    const cr = await fetch(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'hermes-notes',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!cr.ok) throw new Error(`Drive create folder failed: ${cr.status}`);
    const cj = await cr.json();
    this.cfg.folderId = cj.id;
    return cj.id;
  }

  /** List all notes in the notes folder, newest first. */
  async listNotes(): Promise<DriveFile[]> {
    const folderId = await this.ensureNotesFolder();
    const token = await this.ensureFreshToken();
    const q = encodeURIComponent(
      `'${folderId}' in parents and mimeType='text/markdown' and trashed=false`,
    );
    const r = await fetch(
      `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=200`,
      {headers: {Authorization: `Bearer ${token}`}},
    );
    if (!r.ok) throw new Error(`Drive list failed: ${r.status}`);
    const j = await r.json();
    return (j.files ?? []) as DriveFile[];
  }

  /** Read a note's text content. */
  async readFile(fileId: string): Promise<string> {
    const token = await this.ensureFreshToken();
    const r = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!r.ok) throw new Error(`Drive read failed: ${r.status}`);
    return r.text();
  }

  /** Create or update a note. Returns the file id. */
  async writeFile(name: string, content: string, existingId?: string): Promise<string> {
    const folderId = await this.ensureNotesFolder();
    const token = await this.ensureFreshToken();

    if (existingId) {
      const r = await fetch(
        `${DRIVE_UPLOAD}/files/${existingId}?uploadType=media&fields=id,modifiedTime`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/markdown',
          },
          body: content,
        },
      );
      if (!r.ok) throw new Error(`Drive update failed: ${r.status}`);
      const j = await r.json();
      return j.id as string;
    }

    const meta = {
      name: name.endsWith('.md') ? name : `${name}.md`,
      mimeType: 'text/markdown',
      parents: [folderId],
    };
    const boundary = '-------hermes-' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(meta) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/markdown\r\n\r\n` +
      content + `\r\n` +
      `--${boundary}--`;
    const r = await fetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!r.ok) throw new Error(`Drive create failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.id as string;
  }

  /** Move a file to trash. */
  async deleteFile(fileId: string): Promise<void> {
    const token = await this.ensureFreshToken();
    const r = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!r.ok && r.status !== 204) throw new Error(`Drive delete failed: ${r.status}`);
  }

  /** Fetch the user profile (for showing "Signed in as X" in settings). */
  async me(): Promise<{email: string; name: string}> {
    const token = await this.ensureFreshToken();
    const r = await fetch(`${DRIVE_API}/about?fields=user(emailAddress,displayName)`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!r.ok) throw new Error(`Drive /about failed: ${r.status}`);
    const j = await r.json();
    return {email: j.user.emailAddress, name: j.user.displayName};
  }
}
