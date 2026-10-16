// Home photo upload rules, shared by Edit Home and Home Facts. A chosen file is
// only staged locally until Save; nothing is uploaded before then, so Cancel
// never leaves an orphaned object in Storage.
export const PHOTO_BUCKET = 'home-photos';
export const ALLOWED_PHOTO_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — covers a full-resolution phone photo/screenshot.

// '' when the file is acceptable, otherwise the message to show.
export function photoFileError(file) {
  if (!file) return '';
  if (!ALLOWED_PHOTO_TYPES[file.type]) return 'Please choose a JPEG, PNG, or WebP image.';
  if (file.size > MAX_PHOTO_BYTES) return 'That image is larger than 5MB — please choose a smaller one.';
  return '';
}

// Uploads into the caller's own folder and returns the public URL.
export async function uploadHomePhoto(supabase, userId, file) {
  const ext = ALLOWED_PHOTO_TYPES[file.type] || 'jpg';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data?.publicUrl || '';
}

// Pure. The object path within PHOTO_BUCKET when this is one of our own public
// Storage URLs, or null for a pasted external URL (which is never deleted).
export function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}
