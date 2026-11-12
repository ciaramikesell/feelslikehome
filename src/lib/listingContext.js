// Add Home V3, phase 3 (docs/add-home-v3-rentcast-context.md): context from
// the RentCast lookup FLH already made when the home was added, read back from
// the saved snapshot (homes.listing_import). Pure: no request, no storage, no
// Match. Everything here is CONTEXT for the buyer, never a Home Fact value and
// never a Match answer:
//   - county records (property record): subdivision, stories, foundation, view,
//     and a fireplace / pool the record says EXISTS (false or missing is never
//     shown and never means "no");
//   - the listing as it was when the home was added: status, listing type,
//     listed / removed dates, days on market, and earlier listing periods. It
//     is a snapshot, so it always carries the date it was taken.
// Stories and foundation never prove a layout or a basement's condition.

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function factValue(snapshot, key) {
  const fact = Array.isArray(snapshot?.listingFacts) ? snapshot.listingFacts.find((item) => item?.key === key) : null;
  return fact ? fact.value : null;
}

const isRentCast = (snapshot) => snapshot?.source === 'rentcast';

/**
 * County-record context for a saved home. Each entry is null unless the record
 * stated it. Fireplace / pool are { type } only when the record says the
 * feature exists.
 */
export function countyRecordContext(snapshot) {
  if (!isRentCast(snapshot)) return { subdivision: null, stories: null, foundation: null, view: null, fireplace: null, pool: null };
  const stories = Number(factValue(snapshot, 'stories'));
  const feature = (key) => {
    const value = factValue(snapshot, key);
    if (value === true) return { type: null };
    return text(value) ? { type: text(value) } : null;
  };
  return {
    subdivision: text(factValue(snapshot, 'subdivision')),
    stories: Number.isInteger(stories) && stories > 0 && stories < 10 ? stories : null,
    foundation: text(factValue(snapshot, 'foundation')),
    view: text(factValue(snapshot, 'viewType')),
    fireplace: feature('fireplace'),
    pool: feature('pool'),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => (typeof value === 'string' && DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? value : null);

export function formatShortDate(value) {
  const date = validDate(value);
  if (!date) return null;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The listing as the lookup saw it when the home was added, or null.
 * `asOf` is the import date: this is never presented as current.
 * `earlier` lists earlier listing periods (dates and days only; no prices and
 * no inferred price changes), excluding the current period.
 */
export function listingSnapshotContext(snapshot) {
  const listing = isRentCast(snapshot) ? snapshot.listing : null;
  if (!listing || typeof listing !== 'object') return null;
  const asOf = validDate(typeof snapshot.importedAt === 'string' ? snapshot.importedAt.slice(0, 10) : null);
  const status = ['active', 'inactive'].includes(listing.status) ? listing.status : null;
  const listedDate = validDate(listing.listedDate);
  const removedDate = status === 'inactive' ? validDate(listing.removedDate) : null;
  const days = Number(listing.daysOnMarket);
  const listingType = ['New Construction', 'Foreclosure', 'Short Sale'].includes(listing.listingType) ? listing.listingType : null;
  const earlier = (Array.isArray(listing.history) ? listing.history : [])
    .filter((item) => validDate(item?.listedDate) && item.listedDate !== listedDate && (!listedDate || item.listedDate < listedDate))
    .filter((item) => !item.removedDate || (validDate(item.removedDate) && item.removedDate >= item.listedDate))
    .map((item) => ({ listedDate: item.listedDate, removedDate: validDate(item.removedDate), daysOnMarket: Number.isInteger(item.daysOnMarket) && item.daysOnMarket >= 0 ? item.daysOnMarket : null }))
    .slice(0, 3);
  if (!status && !listedDate && !listingType && !earlier.length) return null;
  return {
    asOf,
    status,
    listingType,
    listedDate,
    removedDate,
    daysOnMarket: status === 'active' && Number.isInteger(days) && days >= 0 ? days : null,
    earlier,
  };
}

/** One line per fact, in the buyer's words, for display. Nothing is inferred. */
export function listingSnapshotLines(context) {
  if (!context) return [];
  const lines = [];
  const asOf = formatShortDate(context.asOf);
  const status = context.status === 'active' ? 'Active' : context.status === 'inactive' ? 'No longer listed' : null;
  const parts = [
    status,
    context.listedDate && `listed ${formatShortDate(context.listedDate)}`,
    context.removedDate && `removed ${formatShortDate(context.removedDate)}`,
    context.daysOnMarket !== null && context.daysOnMarket !== undefined && `${context.daysOnMarket} day${context.daysOnMarket === 1 ? '' : 's'} on market`,
  ].filter(Boolean);
  if (parts.length) lines.push(`${asOf ? `When added (${asOf}): ` : 'When added: '}${parts.join(' · ')}`);
  if (context.listingType) lines.push(`Listing type: ${context.listingType}`);
  for (const item of context.earlier) {
    const range = item.removedDate ? `${formatShortDate(item.listedDate)} – ${formatShortDate(item.removedDate)}` : `from ${formatShortDate(item.listedDate)}`;
    lines.push(`Listed before: ${range}${item.daysOnMarket !== null ? ` (${item.daysOnMarket} day${item.daysOnMarket === 1 ? '' : 's'})` : ''}`);
  }
  return lines;
}
