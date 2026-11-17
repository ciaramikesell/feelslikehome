// Display metadata only. The original image and its URL query are never changed.
// Components must use these helpers, never inspect fragments themselves.
const MARKER = 'flh-photo-frame=';
const PREFIX = `/storage/v1/object/public/home-photos/`;
export const CENTERED_PHOTO = Object.freeze({ x: 50, y: 50 });
const coordinate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const validPosition = value => value && coordinate(value.x) && coordinate(value.y);
const frameFragment = (fragment, position) => MARKER + encodeURIComponent(JSON.stringify({ version: 1, fragment, position }));
// Budget for any numeric coordinates, not just the current ones. Refuse a
// very long original fragment rather than writing metadata we cannot read.
const fragmentFits = fragment => frameFragment(fragment, { x: '0'.repeat(64), y: '0'.repeat(64) }).length <= 8192;
const split = value => {
  const raw = typeof value === 'string' ? value : '';
  const at = raw.indexOf('#');
  return { raw, base: at < 0 ? raw : raw.slice(0, at), fragment: at < 0 ? null : raw.slice(at + 1) };
};
const httpUrl = value => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
};
const storageIdentity = (source, supabaseUrl, publicOnly = false) => {
  const url = httpUrl(source), backend = httpUrl(supabaseUrl);
  if (!url || !backend || url.origin !== backend.origin) return null;
  const prefixes = publicOnly ? [PREFIX] : [PREFIX, '/storage/v1/object/sign/home-photos/', '/storage/v1/render/image/public/home-photos/', '/storage/v1/render/image/sign/home-photos/'];
  const prefix = prefixes.find(value => url.pathname.startsWith(value));
  if (!prefix) return null;
  // Only public app-upload paths. Signed URLs, image transforms, arbitrary
  // folders and encoded path separators are deliberately unsupported.
  const path = url.pathname.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-z_-]+\.(?:jpe?g|png|webp)$/i.test(path) ? path : null;
};

export function parsePhotoUrl(value, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const parts = split(value);
  let originalFragment = parts.fragment;
  let envelope = null;
  let malformed = false;
  if (parts.fragment?.startsWith(MARKER)) {
    try {
      if (parts.fragment.length > 65536) throw Error('oversized envelope');
      const decoded = JSON.parse(decodeURIComponent(parts.fragment.slice(MARKER.length)));
      if (!decoded || !Number.isInteger(decoded.version) || !(decoded.fragment === null || typeof decoded.fragment === 'string')) throw Error('unsupported envelope');
      envelope = decoded;
      originalFragment = decoded.fragment;
    } catch { malformed = true; }
  }
  const source = parts.base + (originalFragment === null ? '' : `#${originalFragment}`);
  const path = storageIdentity(parts.base, supabaseUrl, true);
  const editable = Boolean(path && !malformed && (!envelope || envelope.version === 1) && fragmentFits(originalFragment));
  const position = editable && envelope?.version === 1 && validPosition(envelope.position) ? { ...envelope.position } : { ...CENTERED_PHOTO };
  return { source, base: parts.base, originalFragment, position, editable, storagePath: path, malformed, version: envelope?.version ?? null };
}

export function serializePhotoFrame(value, position, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const photo = parsePhotoUrl(value, supabaseUrl);
  if (!photo.editable || !validPosition(position)) return value;
  // Reset is an exact round trip, including a pre-existing empty '#' or
  // Unicode/encoded fragments. Never replace an unrelated fragment in place.
  if (position.x === 50 && position.y === 50) return photo.source;
  return `${photo.base}#${frameFragment(photo.originalFragment, { x: position.x, y: position.y })}`;
}

export function photoRequestUrl(value, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const photo = parsePhotoUrl(value, supabaseUrl);
  // An unrecognized reserved fragment might be a legitimate old fragment.
  // Preserve it, refuse editing, and let normal URL semantics omit it from
  // HTTP requests. Only structurally recognized envelopes are unwrapped.
  const source = photo.source;
  // Local assets and local file previews are display-only, never valid Photo
  // URL entries or automatic server imports. No data/javascript/protocol-relative URLs.
  if (/^\/images\//.test(source) || /^blob:/.test(source)) return source;
  return httpUrl(source) ? source : null;
}

export function validatePhotoUrl(value, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const raw = String(value ?? '');
  if (!raw.trim()) return '';
  const photo = parsePhotoUrl(raw, supabaseUrl);
  if (!httpUrl(photo.malformed ? photo.base : photo.source)) return undefined;
  // Validation is not a migration. Preserve even future/unrecognized metadata
  // verbatim on unrelated saves; the display helper still centers unsupported
  // sources. Signed query bytes are likewise untouched.
  return raw;
}

export function photoStoragePath(value, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  return parsePhotoUrl(value, supabaseUrl).storagePath;
}
export function samePhoto(a, b, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  // Image identity excludes fragments (including unrelated media fragments),
  // while display requests retain legitimate original fragments. Queries are
  // never decoded/re-encoded or reordered, including signatures.
  const left = parsePhotoUrl(a, supabaseUrl).base, right = parsePhotoUrl(b, supabaseUrl).base;
  const leftObject = storageIdentity(left, supabaseUrl), rightObject = storageIdentity(right, supabaseUrl);
  if (leftObject && rightObject) return leftObject === rightObject;
  return left === right;
}
export function photoObjectPosition(value, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const { x, y } = parsePhotoUrl(value, supabaseUrl).position;
  return `${x}% ${y}%`;
}
