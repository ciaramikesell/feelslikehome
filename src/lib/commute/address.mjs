import { createHash } from 'node:crypto';

export function normalizeAddressForFingerprint(address) {
  return String(address || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function addressFingerprint(address) {
  return createHash('sha256').update(normalizeAddressForFingerprint(address)).digest('hex');
}

export function hasCurrentCoordinates(record) {
  return record?.latitude != null
    && record?.longitude != null
    && record.coordinate_address_fingerprint === addressFingerprint(record.address);
}
