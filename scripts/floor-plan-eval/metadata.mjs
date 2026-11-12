// Independent image-metadata inspector (no image library). Used to PROVE that
// normalized bytes carry no personal metadata before anything could be sent
// to a provider, and to prove the fixtures used in that test really do carry
// it. Parses JPEG markers, PNG chunks and WebP RIFF chunks directly.

const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');

function inspectJpeg(buf) {
  const findings = [];
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no metadata after this
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
    const length = buf.readUInt16BE(offset + 2);
    const body = buf.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && ascii(body, 0, 6) === 'Exif\0\0') {
      findings.push({ kind: 'exif', bytes: body.length, gps: exifHasGps(body.subarray(6)), tags: exifIfd0Tags(body.subarray(6)) });
    } else if (marker === 0xe1 && ascii(body, 0, 28).startsWith('http://ns.adobe.com/xap/1.0/')) {
      findings.push({ kind: 'xmp', bytes: body.length });
    } else if (marker === 0xed) {
      findings.push({ kind: 'iptc', bytes: body.length });
    } else if (marker === 0xe2 && ascii(body, 0, 11) === 'ICC_PROFILE') {
      findings.push({ kind: 'icc', bytes: body.length });
    } else if (marker === 0xfe) {
      findings.push({ kind: 'comment', bytes: body.length, text: ascii(body, 0, Math.min(body.length, 80)) });
    } else if (marker >= 0xe1 && marker <= 0xef) {
      findings.push({ kind: `app${marker - 0xe0}`, bytes: body.length });
    }
    offset += 2 + length;
  }
  return findings;
}

// TIFF structure inside EXIF: walk IFD0 and report tag ids; GPS = tag 0x8825.
function exifIfd0Tags(tiff) {
  try {
    const little = ascii(tiff, 0, 2) === 'II';
    const u16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    const ifd = u32(4);
    const count = u16(ifd);
    const tags = [];
    for (let i = 0; i < count; i += 1) tags.push(u16(ifd + 2 + i * 12));
    return tags;
  } catch {
    return [];
  }
}
const exifHasGps = (tiff) => exifIfd0Tags(tiff).includes(0x8825);

function inspectPng(buf) {
  const findings = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = ascii(buf, offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const keyword = ascii(data, 0, Math.max(0, data.indexOf(0)));
      findings.push({ kind: 'png_text', chunk: type, keyword, bytes: length });
    } else if (type === 'eXIf') {
      findings.push({ kind: 'exif', chunk: type, bytes: length, gps: exifHasGps(data), tags: exifIfd0Tags(data) });
    } else if (type === 'iCCP') {
      findings.push({ kind: 'icc', chunk: type, bytes: length });
    } else if (type === 'tIME') {
      findings.push({ kind: 'png_time', chunk: type, bytes: length });
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return findings;
}

function inspectWebp(buf) {
  const findings = [];
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const type = ascii(buf, offset, offset + 4);
    const length = buf.readUInt32LE(offset + 4);
    if (type === 'EXIF') findings.push({ kind: 'exif', chunk: type, bytes: length });
    if (type === 'XMP ') findings.push({ kind: 'xmp', chunk: type, bytes: length });
    if (type === 'ICCP') findings.push({ kind: 'icc', chunk: type, bytes: length });
    offset += 8 + length + (length % 2);
  }
  return findings;
}

export function detectFormat(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  return 'unknown';
}

// Kinds that can carry personal data (location, device, author, dates, free text).
export const PERSONAL_METADATA_KINDS = Object.freeze(new Set(['exif', 'xmp', 'iptc', 'comment', 'png_text', 'png_time', 'app3', 'app4', 'app5', 'app6', 'app7', 'app8', 'app9', 'app10', 'app11', 'app12', 'app14', 'app15']));

export function inspectImageMetadata(buf) {
  const format = detectFormat(buf);
  const findings = format === 'jpeg' ? inspectJpeg(buf) : format === 'png' ? inspectPng(buf) : format === 'webp' ? inspectWebp(buf) : [];
  // APP14 "Adobe" is a colour-transform flag written by encoders, not personal data.
  const personal = findings.filter((f) => PERSONAL_METADATA_KINDS.has(f.kind) && f.kind !== 'app14');
  return { format, findings, personal, clean: format !== 'unknown' && personal.length === 0, hasGps: findings.some((f) => f.gps) };
}
