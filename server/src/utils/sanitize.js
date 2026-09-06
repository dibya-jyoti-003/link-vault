import path from 'path';

// Extensions that should never be accepted as an upload, regardless of
// declared MIME type (which the client fully controls and cannot be trusted).
const DEFAULT_BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'cpl', 'msi', 'msp', 'scr', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'ps1', 'ps1xml', 'psc1', 'jar', 'app', 'dmg',
  'sh', 'bash', 'apk', 'dll', 'reg', 'lnk', 'gadget', 'hta',
];

export function getBlockedExtensions() {
  const fromEnv = (process.env.BLOCKED_EXTENSIONS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  return new Set(fromEnv.length > 0 ? fromEnv : DEFAULT_BLOCKED_EXTENSIONS);
}

/**
 * Strip directory components, control characters and excess length from a
 * user-supplied filename. The result is for *display / metadata* only -
 * it must never be used to construct a path on disk.
 */
export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  // Drop any path component the client might have sent.
  let base = path.basename(name.replace(/\\/g, '/'));
  // Remove control characters and characters that are unsafe in headers/UI.
  base = base.replace(/[\x00-\x1f\x7f"<>|:*?/\\]/g, '').trim();
  if (!base) base = 'file';
  if (base.length > 200) {
    const ext = path.extname(base);
    base = base.slice(0, 200 - ext.length) + ext;
  }
  return base;
}

export function getExtension(filename) {
  return path.extname(filename || '').replace(/^\./, '').toLowerCase();
}

/** Safe value for a Content-Disposition header (avoids header/response splitting). */
export function contentDispositionFilename(filename) {
  const safe = sanitizeFilename(filename).replace(/[\r\n]/g, '');
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${safe.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
}
