import { defaultPriorities, getItemlistCategories, TIER_ORDER } from '../constants.js';
import { NEW_SEARCH_CHOICES } from '../onboarding.js';
import { onboardingStepsFor } from '../onboardingFlow.js';
import { cleanFeatureLabel, normalizeFeatureKey, priorityCategoriesFor, PRIORITY_CATEGORIES } from '../priorityCategories.js';
import { prioritiesForExplicitSave } from '../searchIntent.js';
import { UUID, DRAFT_TTL } from './draft.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const allowedKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
export const exactKeys = (value, keys) => allowedKeys(value, keys) && keys.every(key => Object.hasOwn(value, key));
const tier = value => TIER_ORDER.includes(value);
const array = (value, has, max = 150) => Array.isArray(value) && value.length <= max &&
  new Set(value).size === value.length && value.every(has);
const categories = ['location', 'homeFeel', 'exterior', 'features'];
const basicScores = ['budget', 'sqftTarget', 'lotSizeTarget', 'bedsMin', 'bathsMin'];
const garage = value => ['attached', 'detached', 'any'].includes(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const cleanLabel = label => typeof label === 'string' && !!normalizeFeatureKey(label) &&
  cleanFeatureLabel(label) === label && !['__proto__', 'constructor', 'prototype'].includes(label);

export async function readGuestJson(request) {
  const max = 77_536;
  if (!request.body || Number(request.headers.get('content-length')) > max) throw new Error('Invalid size');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error('Invalid size');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(raw);
  const bounded = (node, depth) => depth <= 10 && (node === null || typeof node !== 'object' ||
    Object.entries(node).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key) && bounded(child, depth + 1)));
  if (!record(value) || !bounded(value, 0)) throw new Error('Invalid shape');
  return value;
}

function catalogFor(choice, key) {
  const definitions = getItemlistCategories(choice.intent).find(cat => cat.key === key);
  const flow = priorityCategoriesFor({ searchType: choice.intent, onboardingSearchType: choice.key });
  const offerings = [
    ...(definitions?.coreItems || []), ...(definitions?.suggestedItems || []),
    ...flow.flatMap(cat => [...cat.features, ...cat.suggestions]).filter(item => item.categoryKey === key),
  ];
  if (key === 'exterior') offerings.push({ label: 'Garage', kind: 'check' });
  if (key === 'features' && choice.intent === 'rental') offerings.push({ label: 'Pets Allowed', kind: 'check' });
  return offerings;
}

function categoryValid(section, key, choice) {
  const base = ['customItems', 'tiers', 'order', 'hiddenCore'];
  const extra = key === 'location' ? ['commuteDestinations'] : key === 'exterior' ? ['garagePreference', 'heldGarage']
    : key === 'features' ? ['petsMoving', 'petsAuto'] : [];
  if (!allowedKeys(section, [...base, ...extra]) || !base.every(field => Object.hasOwn(section, field))) return false;
  if (!array(section.hiddenCore, () => false) ||
      ('commuteDestinations' in section && !array(section.commuteDestinations, () => false))) return false;
  if ('garagePreference' in section && (!garage(section.garagePreference) || choice.key === 'apartment_rent')) return false;
  if ('heldGarage' in section && (!allowedKeys(section.heldGarage, ['house', 'apartment']) ||
      !Object.entries(section.heldGarage).every(([kind, held]) => allowedKeys(held, kind === 'house' ? ['tier', 'garagePreference'] : ['tier']) &&
        Object.keys(held).length > 0 && (!('tier' in held) || tier(held.tier)) &&
        (!('garagePreference' in held) || garage(held.garagePreference))))) return false;
  if ('petsMoving' in section && (choice.intent !== 'rental' || !['yes', 'no', 'not_sure'].includes(section.petsMoving))) return false;
  if ('petsAuto' in section && (section.petsMoving !== 'yes' || section.tiers?.['Pets Allowed'] !== 'must' ||
      !exactKeys(section.petsAuto, ['previousTier', 'setAt']) ||
      !(section.petsAuto.previousTier === null || tier(section.petsAuto.previousTier)) || !iso(section.petsAuto.setAt))) return false;

  const current = catalogFor(choice, key);
  const all = NEW_SEARCH_CHOICES.flatMap(item => catalogFor(item, key));
  const groupAllowed = group => (key === 'features' && group === 'own') ||
    PRIORITY_CATEGORIES.some(cat => cat.key === group && cat.storage === key) ||
    all.some(item => item.group === group && typeof group === 'string');
  const custom = new Set();
  if (!array(section.customItems, item => {
    if (!allowedKeys(item, ['label', 'kind', 'source', 'group']) || !cleanLabel(item.label) ||
        custom.has(normalizeFeatureKey(item.label)) || ('group' in item && !groupAllowed(item.group))) return false;
    const offered = all.some(candidate => candidate.label === item.label && candidate.kind === item.kind);
    if ('source' in item ? (item.source !== 'custom' || item.kind !== 'check') : !offered) return false;
    custom.add(normalizeFeatureKey(item.label));
    return true;
  }, 100)) return false;
  const selected = new Set([...current.map(item => item.label), ...section.customItems.map(item => item.label)]);
  const known = new Set([...selected, ...all.map(item => item.label)]);
  return record(section.tiers) && Object.keys(section.tiers).length <= 150 &&
    Object.entries(section.tiers).every(([label, level]) => tier(level) &&
      (level === 'dontcare' ? known.has(label) : selected.has(label))) &&
    array(section.order, label => known.has(label));
}

export function validateGuestPriorities(value, { incomplete = false } = {}) {
  const defaults = defaultPriorities();
  if (!allowedKeys(value, [...Object.keys(defaults), 'onboardingSearchType']) ||
      !Object.keys(defaults).every(key => Object.hasOwn(value, key))) return null;
  if (incomplete && !Object.hasOwn(value, 'onboardingSearchType') && JSON.stringify(value) === JSON.stringify(defaults)) return value;
  const choice = NEW_SEARCH_CHOICES.find(item => item.key === value.onboardingSearchType);
  if (!choice || value.searchType !== choice.intent) return null;
  if (!basicScores.every(key => exactKeys(value[key], ['value', 'tier']) && tier(value[key].tier) &&
      typeof value[key].value === 'string' && value[key].value.length <= 64 &&
      (key === 'lotSizeTarget' ? /^[\d.,\s]*(?:acres?|ac|sq\s*ft|sqft|sf)?$/i : /^\d*(?:\.\d*)?$/).test(value[key].value))) return null;
  if (!exactKeys(value.preferredPropertyTypes, ['values', 'tier']) || !tier(value.preferredPropertyTypes.tier) ||
      !array(value.preferredPropertyTypes.values, item => item === choice.propertyType)) return null;
  for (const key of ['planningToLiveIn', 'investmentPropertyTypes', 'homeLayout', 'homeCondition',
    'primaryBedroomLocation', 'secondaryBedroomLocation']) {
    if (JSON.stringify(value[key]) !== JSON.stringify(defaults[key])) return null;
  }
  if (!categories.every(key => categoryValid(value[key], key, choice))) return null;
  return prioritiesForExplicitSave(value);
}

export function validateGuestTransfer(body, now = Date.now()) {
  if (!exactKeys(body, ['draftId', 'priorities', 'progress']) || !UUID.test(body.draftId ?? '')) return null;
  const priorities = validateGuestPriorities(body.priorities);
  const progress = body.progress;
  if (!priorities || !exactKeys(progress, ['schema', 'step', 'completed', 'answers', 'skipped', 'startedAt']) ||
      progress.schema !== 1 || !exactKeys(progress.answers, ['searchType', 'setupPath']) ||
      progress.answers.searchType !== priorities.onboardingSearchType ||
      !['personalize', 'as_i_go'].includes(progress.answers.setupPath) ||
      progress.step !== (progress.answers.setupPath === 'personalize' ? 'review' : 'basics') ||
      !iso(progress.startedAt) || Date.parse(progress.startedAt) > now ||
      Date.parse(progress.startedAt) < now - DRAFT_TTL * 1000) return null;
  const flow = onboardingStepsFor(4, progress);
  if (!array(progress.completed, step => flow.includes(step)) ||
      !flow.slice(0, -1).every(step => progress.completed.includes(step)) ||
      !array(progress.skipped, step => step !== 'review' && flow.slice(2).includes(step) && progress.completed.includes(step))) return null;
  return { draftId: body.draftId, priorities, progress: { ...progress,
    completed: flow, skipped: flow.filter(step => progress.skipped.includes(step)) } };
}
