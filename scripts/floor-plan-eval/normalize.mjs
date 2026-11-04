// Normalizes a floor-plan image before any provider could see it:
//   * accept only JPEG / PNG / WebP, ≤ 10 MB (the bucket's own limits);
//   * apply EXIF orientation, then drop ALL metadata (EXIF/GPS, XMP, IPTC,
//     ICC, comments, PNG text) — sharp writes none unless asked to;
//   * downscale to ≤ 2,576 px on the long edge (Claude's high-resolution cap);
//   * re-encode: PNG for line art (PNG/WebP input), high-quality JPEG for photos.
// The result is checked with the independent inspector in metadata.mjs; a
// non-clean result throws, so a caller can never send it.
import { detectFormat, inspectImageMetadata } from './metadata.mjs';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_LONG_EDGE = 2576;

let sharpModule;
async function loadSharp() {
  if (!sharpModule) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch {
      throw new Error('sharp is not installed. Run `npm ci` (sharp is installed with next).');
    }
  }
  return sharpModule;
}

export class NormalizeError extends Error {}

export async function normalizeImage(input) {
  if (!Buffer.isBuffer(input) || !input.length) throw new NormalizeError('empty input');
  if (input.length > MAX_INPUT_BYTES) throw new NormalizeError('image larger than 10 MB');
  const format = detectFormat(input);
  if (!['jpeg', 'png', 'webp'].includes(format)) throw new NormalizeError(`unsupported image type (${format})`);
  const sharp = await loadSharp();
  const pipeline = sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 })
    .rotate() // honour EXIF orientation before the metadata is discarded
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true });
  const outFormat = format === 'jpeg' ? 'jpeg' : 'png';
  const { data, info } = await (outFormat === 'jpeg'
    ? pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    : pipeline.png({ compressionLevel: 9 })
  ).toBuffer({ resolveWithObject: true });
  const metadata = inspectImageMetadata(data);
  if (!metadata.clean) throw new NormalizeError(`normalized image still carries metadata: ${metadata.personal.map((f) => f.kind).join(', ')}`);
  return {
    buffer: data,
    mimeType: outFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: info.width,
    height: info.height,
    bytes: data.length,
    metadata,
    estimatedClaudeImageTokens: estimateClaudeImageTokens(info.width, info.height),
  };
}

// Claude: ⌈w/28⌉ × ⌈h/28⌉ visual tokens, high-resolution tier capped at
// 2,576 px long edge and 4,784 tokens (platform.claude.com vision docs,
// checked 2026-10-31). Above the token cap the API downsizes further; this
// mirrors that by shrinking until the cap holds.
export function estimateClaudeImageTokens(width, height, { maxLongEdge = MAX_LONG_EDGE, maxTokens = 4784 } = {}) {
  let scale = Math.min(1, maxLongEdge / Math.max(width, height));
  let w = Math.round(width * scale);
  let h = Math.round(height * scale);
  while (Math.ceil(w / 28) * Math.ceil(h / 28) > maxTokens) {
    scale *= 0.99;
    w = Math.round(width * scale);
    h = Math.round(height * scale);
  }
  return Math.ceil(w / 28) * Math.ceil(h / 28);
}
