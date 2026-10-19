// Lot size as a measurement in acres, the unit Match's lot-size target uses.
//
// homes.lot_size is free text with several stored shapes: RentCast imports
// write "8850 sq ft" (under an acre) or "1.25 acres"; Home Facts edits write
// "0.25 acres" / "1 acre"; pasted listing text and the Add Home form can keep
// "8,850 sq ft" or whatever a person typed. lotSizeAcres reads every one of
// them with its unit, so "8850 sq ft" is 0.203 acres, never 8,850 acres.
//
// A saved value must carry its unit. A saved bare number ("8712") has no
// recorded unit — it could be acres or square feet — so it is null (Unknown),
// never guessed at; the displays say "unit not recorded". A bare number a
// person TYPES into a field labeled in acres is acres (typedLotSizeAcres), and
// is saved with its unit, so no new value is ambiguous. Anything else — an
// unknown unit, a fraction, a European decimal comma, zero — is also null:
// Unknown, which Match never counts as a miss or a match.
// resolve_cobuyer_compare_perspectives (2026-10-18-lot-size-units-match-parity.sql)
// applies the same grammar, so a co-buyer's Match reads the same lot size on
// both sides, and formatLotSizeDisplay shows exactly what Match scores.

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
const LOT_SIZE_NUMBER = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d*\\.?\\d+';
const LOT_SIZE_PATTERN = new RegExp(`^(${LOT_SIZE_NUMBER})\\s*(.*)$`);
const BARE_NUMBER = new RegExp(`^(?:${LOT_SIZE_NUMBER})$`);

function parseLotSize(raw) {
  const match = String(raw ?? '').trim().match(LOT_SIZE_PATTERN);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? { amount, unit: match[2].trim() } : null;
}

function toAcres({ amount, unit }) {
  const convert = LOT_SIZE_UNITS_TO_ACRES.find(([pattern]) => pattern.test(unit))?.[1];
  return convert ? convert(amount) : null;
}

// A saved lot size in acres: Match, the co-buyer Compare scorer and every display.
export function lotSizeAcres(raw) {
  const parsed = parseLotSize(raw);
  return parsed && parsed.unit !== '' ? toAcres(parsed) : null;
}

// A saved bare number: a lot size whose unit was never recorded.
export function isUnitlessLotSize(raw) {
  return BARE_NUMBER.test(String(raw ?? '').trim()) && parseLotSize(raw) !== null;
}

// What a person typed into a field labeled in acres: a bare number is acres.
export function typedLotSizeAcres(raw) {
  const parsed = parseLotSize(raw);
  if (!parsed) return null;
  return parsed.unit === '' ? parsed.amount : toAcres(parsed);
}

// A bare number typed into a lot-size field labeled in acres is saved with its
// unit ("0.25" -> "0.25 acres"), so a new value is never ambiguous later.
// Anything else (a unit, text, zero) is saved exactly as typed.
export function withAcresUnit(raw) {
  if (!isUnitlessLotSize(raw)) return raw;
  const text = String(raw).trim();
  return `${text} ${typedLotSizeAcres(text) === 1 ? 'acre' : 'acres'}`;
}
