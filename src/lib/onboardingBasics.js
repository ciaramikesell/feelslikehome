import { ONBOARDING_SUGGESTIONS, applySearchChoice } from './onboarding.js';
import { addCriterion, moveCriterion, priorityLevels } from './searchProfile.js';

// Pure helpers for the Onboarding V2 Basics step. Every stored value keeps the
// format the rest of FLH already reads: Basics are digit strings that parseNum
// (and therefore Match) understands, and an empty string means "not set". An
// unanswered question is never turned into 0, "No", or a preference.

// Formats stored digits for display: '650000' → '650,000'. Empty stays empty.
export function formatThousands(digits) {
  const clean = String(digits ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A user edit of a comma-formatted field. Returns the digits to store, the text
// to show, and where the caret belongs so typing in the middle of a number does
// not jump to the end: the caret stays after the same count of digits.
export function editFormattedNumber(rawText, caret = String(rawText ?? '').length) {
  const text = String(rawText ?? '');
  const digitsBeforeCaret = text.slice(0, caret).replace(/[^0-9]/g, '').length;
  const digits = text.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  const display = formatThousands(digits);
  let seen = 0;
  let position = 0;
  // Leading zeros removed above shift the count; clamp to what remains.
  const target = Math.min(digitsBeforeCaret, digits.length);
  while (position < display.length && seen < target) {
    if (/[0-9]/.test(display[position])) seen += 1;
    position += 1;
  }
  return { digits, display, caret: position };
}

// Stepper rules. Unset ('') is a real state: the first + sets the minimum, and −
// at the minimum clears the answer rather than inventing a smaller number.
export const STEPPERS = Object.freeze({
  bedsMin: Object.freeze({ min: 1, step: 1, max: 10 }),
  bathsMin: Object.freeze({ min: 1, step: 0.5, max: 10 }),
});

const parseStored = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const toStored = (number) => String(Math.round(number * 100) / 100);

export function stepUp(value, { min, step, max }) {
  const current = parseStored(value);
  if (current === null || current < min) return toStored(min);
  // Snap an existing off-step value (e.g. 1.75 baths) up to the next step.
  const next = Math.floor(current / step + 1e-9) * step + step;
  return toStored(Math.min(max, next));
}

export function stepDown(value, { min, step }) {
  const current = parseStored(value);
  if (current === null) return '';
  if (current <= min) return '';
  const next = Math.ceil(current / step - 1e-9) * step - step;
  return next < min ? '' : toStored(next);
}

export function isUnset(value) {
  return parseStored(value) === null;
}

// Garage preferences use the existing storage: the canonical 'exterior:Garage'
// criterion at a level (or not selected), plus exterior.garagePreference for
// attached/detached. 'unset' is the criterion not being on the board at all.
export const GARAGE_LEVELS = Object.freeze([
  Object.freeze({ key: 'unset', label: 'Not set' }),
  Object.freeze({ key: 'nice', label: 'Nice to have' }),
  Object.freeze({ key: 'important', label: 'Important' }),
  Object.freeze({ key: 'must', label: 'Must have' }),
]);

const GARAGE_CRITERION = Object.freeze({ categoryKey: 'exterior', label: 'Garage', kind: 'check' });

// The offered Garage criterion for this kind of search (or the canonical one).
export function garageCriterionFor(choiceKey) {
  return (ONBOARDING_SUGGESTIONS[choiceKey] || []).flatMap(([, items]) => items)
    .find((item) => item.categoryKey === 'exterior' && item.label === 'Garage') || GARAGE_CRITERION;
}

// 'unset' when Garage is not on the board; otherwise its level.
export function garageLevel(priorities) {
  const item = priorityLevels(priorities).flatMap((level) => level.items)
    .find((entry) => entry.categoryKey === 'exterior' && entry.label === 'Garage');
  return item?.tier || 'unset';
}

export function setGarageLevel(priorities, level, choiceKey) {
  if (level === 'unset') return moveCriterion(priorities, 'exterior', 'Garage', 'dontcare');
  return garageLevel(priorities) === 'unset'
    ? addCriterion(priorities, garageCriterionFor(choiceKey), level)
    : moveCriterion(priorities, 'exterior', 'Garage', level);
}

// Choosing (or changing) the kind of search resets curated suggestions from the
// abandoned path (applySearchChoice). A garage answer given on the Basics screen is
// the person's own, so it carries across — except to Apartment, which has no
// garage question.
export function chooseSearchType(priorities, choiceKey) {
  const level = garageLevel(priorities);
  const next = applySearchChoice(priorities, choiceKey);
  if (level === 'unset' || choiceKey === 'apartment_rent') return next;
  return setGarageLevel(next, level, choiceKey);
}
