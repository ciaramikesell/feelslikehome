// Lot size as a measurement in acres, the unit Match's lot-size target uses.
//
// homes.lot_size is free text with several stored shapes: RentCast imports
// write "8850 sq ft" (under an acre) or "1.25 acres"; Home Facts edits write
// "0.25 acres" / "1 acre"; pasted listing text and the Add Home form can keep
// "8,850 sq ft" or whatever a person typed. lotSizeAcres reads every one of
// them with its unit, so "8850 sq ft" is 0.203 acres, never 8,850 acres.
//
// A bare number is acres (the field is labeled in acres, and normalizeLotSizeInput
// stores a typed bare number as acres). Anything else — an unknown unit, a
// fraction, a European decimal comma, zero — is null: Unknown, which Match
// never counts as a miss or a match. resolve_cobuyer_compare_perspectives
// (2026-10-18-lot-size-units-match-parity.sql) applies the same grammar, so a
// co-buyer's Match reads the same lot size on both sides.

export const SQFT_PER_ACRE = 43560;

// Unit -> amount in acres. Dividing (not multiplying by a rounded reciprocal)
// keeps 43,560 sq ft exactly 1 acre, here and in SQL numeric.
const LOT_SIZE_UNITS_TO_ACRES = [
  [/^(?:acres?|ac)\.?$/i, (n) => n],
  [/^(?:sq\.?\s*ft\.?|sqft|sf|ft2|ft²|square\s*f(?:ee|oo)t)$/i, (n) => n / SQFT_PER_ACRE],
  [/^(?:sq\.?\s*m\.?|sqm|m2|m²|square\s*met(?:er|re)s?)$/i, (n) => n / 4046.8564224],
  [/^(?:hectares?|ha)$/i, (n) => n * 2.4710538147],
];

// A number with optional thousands commas ("8,850", "1,234.5"), then the unit.
const LOT_SIZE_PATTERN = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)\s*(.*)$/;

export function lotSizeAcres(raw) {
  const match = String(raw ?? '').trim().match(LOT_SIZE_PATTERN);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  const unit = match[2].trim();
  const toAcres = unit === '' ? (n) => n : LOT_SIZE_UNITS_TO_ACRES.find(([pattern]) => pattern.test(unit))?.[1];
  if (!toAcres || !Number.isFinite(amount) || amount <= 0) return null;
  return toAcres(amount);
}
