/**
 * fileBase64 — read a `file://` URI into a base64 string without an extra
 * native dependency. RN ≥ 0.72 exposes `fetch(uri).then(r => r.blob())` and
 * `blob.arrayBuffer()`; the only piece the stdlib doesn't ship is base64
 * encoding, which this file implements in ~30 lines.
 *
 * Used by the ChatScreen file picker to attach PDFs / images / binaries
 * that the server-side `attachFile` RPC can carry when available. Falls
 * back silently (returning null) when the read fails or the file is too
 * big — callers should preserve a textual breadcrumb in that case so the
 * agent at least knows the user intended to attach something.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Maximum binary size we'll base64-encode inline. Larger files fall back
 *  to a text breadcrumb (the server may still have a streaming attach). */
export const MAX_INLINE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Read a file:// URI into a base64 string (no data: prefix). */
export async function readAsBase64(uri: string, maxBytes = MAX_INLINE_BYTES): Promise<string | null> {
  if (!uri) return null;
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    const size: number = (blob as any).size ?? 0;
    if (size > maxBytes) return null;

    // `.arrayBuffer()` is supported on RN Hermes since 0.72; on older
    // engines we'd have to fall back to `FileReader.readAsDataURL` via
    // a tiny shim, but this codebase is on RN 0.76.5 so we're fine.
    const buf: ArrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let out = '';
    let acc = 0;
    let accBits = 0;
    for (let i = 0; i < bytes.length; i++) {
      acc = (acc << 8) | bytes[i];
      accBits += 8;
      while (accBits >= 6) {
        accBits -= 6;
        out += B64[(acc >> accBits) & 0x3f];
      }
    }
    if (accBits > 0) out += B64[(acc << (6 - accBits)) & 0x3f];
    while (out.length % 4) out += '=';
    return out;
  } catch {
    return null;
  }
}

/** True if MIME / extension looks like a text-y document we can inline. */
export function looksTextual(name?: string, mime?: string): boolean {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (m === 'application/json' || m === 'application/xml' || m === 'application/yaml' || m === 'application/x-yaml') return true;
  const lower = (name ?? '').toLowerCase();
  return ['.txt', '.md', '.csv', '.log', '.tsv', '.py', '.js', '.ts', '.tsx',
          '.jsx', '.json', '.yaml', '.yml', '.html', '.htm', '.css', '.xml',
          '.sql', '.sh', '.bash', '.rs', '.go', '.kt', '.java', '.c', '.cpp',
          '.h', '.hpp', '.swift', '.rb', '.php', '.lua', '.r', '.gradle',
          '.properties', '.ini', '.toml', '.cfg', '.conf', '.env'].some(ext => lower.endsWith(ext));
}
