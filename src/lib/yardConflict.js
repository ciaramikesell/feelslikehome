// Yard answers that contradict each other (founder decision, PR #186).
//
// The old Home Preferences on the live flow's Basics never let Unfenced Yard
// be chosen with Fenced Yard or Privacy Fence (homePreferences.js). V3 offers
// Fenced Yard and Privacy Fence as ordinary priorities, so a buyer who chose
// Unfenced Yard earlier can end up with both. Their earlier choice is
// preserved: nothing here ever changes a priority. This only identifies the
// conflict so Review, the Exterior screen and the desktop board can point it
// out and let the buyer edit either side themselves.
//
// Pure, read-only; no new storage and no Match change.

import { normalizePriorities } from './constants.js';
import { priorityLevels } from './searchProfile.js';

export const UNFENCED_YARD_KEYS = Object.freeze(['exterior:Unfenced Yard']);
// Fenced Yard under every label it is stored as (purchase, and the rental /
// legacy spelling), and Privacy Fence.
export const FENCED_YARD_KEYS = Object.freeze(['exterior:Fenced yard', 'exterior:Fenced Yard', 'exterior:Privacy Fencing']);

const asFeature = (item) => ({
  id: item.key, categoryKey: item.categoryKey, label: item.label, text: item.displayLabel, kind: item.kind,
  custom: false, art: null, icon: null, group: null, role: 'other', level: item.tier,
});

//   → null, or { unfenced, fenced: [...], message } — features (as the
//     importance pickers take them) currently chosen on both sides.
export function yardConflict(raw) {
  const items = priorityLevels(normalizePriorities(raw)).flatMap((level) => level.items);
  const unfenced = items.find((item) => UNFENCED_YARD_KEYS.includes(item.key));
  const fenced = items.filter((item) => FENCED_YARD_KEYS.includes(item.key));
  if (!unfenced || !fenced.length) return null;
  const names = fenced.map((item) => item.displayLabel).join(' and ');
  return {
    unfenced: asFeature(unfenced),
    fenced: fenced.map(asFeature),
    message: `${unfenced.displayLabel} and ${names} are both on your priorities, and no home can be both. Nothing changes until you choose: change or remove whichever doesn’t fit.`,
  };
}
