// Explore My Priorities (Milestone 2, docs/onboarding-paths-explore-priorities.md):
// the V3 category walkthrough, revisitable from My Search at any time.
//
// It edits the SAME document as My Search and onboarding — the participant's
// own search_member_priorities row, through savePriorities — so there is no
// second store and nothing to merge. Where someone was is kept in that same
// document under one namespaced, non-scoring key:
//
//   priorities.explore = { lastStep, visited: [step…], updatedAt }
//
// Being inside the row makes it per person AND per search for free (a
// co-buyer has their own row; switching searches reads that search's row). It
// is never read by Match: computeMatch and the SQL Compare scorer read named
// keys only (proved in test/onboarding-paths-explore-priorities*.test.js).
// profiles.onboarding_state / onboarding_complete / onboarding_version are
// never read or written here.
import { normalizePriorities } from '@/lib/constants';
import { categoryView, priorityCategoriesFor } from '@/lib/priorityCategories';

export const EXPLORE_KEY = 'explore';

const isIsoDate = (value) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

// The category pages this search shows, in the same order as onboarding.
export function exploreSteps(raw) {
  return priorityCategoriesFor(raw).map((category) => category.step);
}

export function exploreCategory(raw, step) {
  return priorityCategoriesFor(raw).find((category) => category.step === step) || null;
}

// The index: every category with what is already chosen on it.
export function exploreIndex(raw) {
  const priorities = normalizePriorities(raw);
  const { visited } = exploreProgress(priorities);
  return priorityCategoriesFor(priorities).map((category) => {
    const view = categoryView(priorities, category.key);
    // The category's own approved photography: a card's, else a suggestion's (Garage has only suggestions).
    const cover = category.question || [...category.features, ...category.suggestions].find((feature) => feature.art) || category.features[0] || null;
    return {
      key: category.key,
      step: category.step,
      title: category.title,
      chosenCount: view?.chosenCount || 0,
      visited: visited.includes(category.step),
      cover: cover ? { art: cover.art || null, icon: cover.icon || null } : null,
    };
  });
}

// Stored progress, trusted only as far as it names a page this search shows.
export function exploreProgress(raw) {
  const priorities = normalizePriorities(raw);
  const stored = priorities[EXPLORE_KEY];
  const steps = exploreSteps(priorities);
  const input = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return {
    lastStep: steps.includes(input.lastStep) ? input.lastStep : null,
    visited: Array.isArray(input.visited) ? [...new Set(input.visited.filter((step) => steps.includes(step)))] : [],
    updatedAt: isIsoDate(input.updatedAt) ? input.updatedAt : null,
  };
}

// Records a visit. Returns the document unchanged (same object) when there is
// nothing new to store, so plain navigation never causes a redundant write.
export function recordExploreVisit(raw, step, now = new Date().toISOString()) {
  const priorities = normalizePriorities(raw);
  if (!exploreSteps(priorities).includes(step)) return raw;
  const progress = exploreProgress(priorities);
  if (progress.lastStep === step && progress.visited.includes(step)) return raw;
  return {
    ...priorities,
    [EXPLORE_KEY]: { lastStep: step, visited: [...new Set([...progress.visited, step])], updatedAt: now },
  };
}

// Where a request to open Explore should land: a valid ?category= wins; the
// index otherwise (null). Accepts a step ('cat_kitchen') or a key ('kitchen').
export function exploreEntryStep(raw, requested) {
  if (!requested || typeof requested !== 'string') return null;
  const category = priorityCategoriesFor(raw).find((entry) => entry.step === requested || entry.key === requested);
  return category ? category.step : null;
}

export function neighborExploreStep(raw, step, direction) {
  const steps = exploreSteps(raw);
  const index = steps.indexOf(step);
  if (index === -1) return null;
  return steps[index + direction] || null;
}
