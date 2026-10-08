// Onboarding progress model: which screens a person sees, in what order, and
// where they resume. Pure and framework-free so the server page, the client
// flow, and tests share one definition.
//
// Storage (profiles, see 2026-10-07-onboarding-state.sql):
//   onboarding_complete  boolean  — the ONLY gate into /onboarding (unchanged).
//   onboarding_version   smallint — flow version this person started/completed.
//                                   null = never versioned. Every account that
//                                   finished onboarding before versioning keeps
//                                   null and is never routed into a newer flow.
//   onboarding_state     jsonb    — this module's state (shape below).
//
// Progress is account-level (it lives on the profile), but the preference
// screens write into one SEARCH. `context` records which search (and in what
// role) the progress was made against, so an invited co-buyer onboarding into
// an existing shared search, or someone who accepts an invitation mid-way,
// never has progress from one search count as done for another.
//
// The answers a screen collects stay where they already live (participant
// priorities in search_member_priorities, names on profiles). The only answers
// kept here are onboarding-only ones, e.g. who someone is searching with.

export const ONBOARDING_STATE_SCHEMA = 1;

// Screens whose answers are written to the onboarding search (scope 'search')
// are re-done when the search changes; account-level screens are not.
const SCOPE = Object.freeze({ ACCOUNT: 'account', SEARCH: 'search' });

export const COLLABORATION_CHOICES = Object.freeze(['solo', 'co_buyer', 'realtor', 'co_buyer_and_realtor']);
export const ONBOARDING_ROLES = Object.freeze(['owner', 'co_buyer']);

export function collaborationIncludes(choice, kind) {
  if (kind === 'co_buyer') return choice === 'co_buyer' || choice === 'co_buyer_and_realtor';
  if (kind === 'realtor') return choice === 'realtor' || choice === 'co_buyer_and_realtor';
  return false;
}

export function isCollaborativeChoice(choice) {
  return Boolean(choice) && choice !== 'solo';
}

const step = (key, scope, options = {}) => Object.freeze({ key, scope, ...options });
const invitedCoBuyer = (state) => state.context?.role === 'co_buyer';

export const ONBOARDING_FLOWS = Object.freeze({
  // The shipped three-screen flow (Basics → What Matters → Rank).
  1: Object.freeze({
    steps: Object.freeze([
      step('basics', SCOPE.SEARCH),
      step('what_matters', SCOPE.SEARCH),
      step('rank', SCOPE.SEARCH),
    ]),
  }),
  // Onboarding V2 (Phase 2 builds the screens). Collaboration comes before any
  // criteria so co-buyers enter their OWN preferences, not a household list.
  // The first-home Match reveal and Get Started follow completion; they are
  // product surfaces, not onboarding steps.
  2: Object.freeze({
    steps: Object.freeze([
      step('welcome', SCOPE.ACCOUNT),
      // Someone who accepted a co-buyer invitation is already searching with
      // someone; asking would contradict the invitation they just accepted.
      step('collaboration', SCOPE.ACCOUNT, { when: (state) => !invitedCoBuyer(state) }),
      // "Everyone gets their own list" — only for people searching with others.
      step('collaboration_intro', SCOPE.ACCOUNT, { when: (state) => invitedCoBuyer(state) || isCollaborativeChoice(state.answers.collaboration) }),
      step('basics', SCOPE.SEARCH, { legacyKeys: ['basics'] }),
      step('locations', SCOPE.SEARCH),
      step('priorities', SCOPE.SEARCH, { legacyKeys: ['what_matters'] }),
      step('rank', SCOPE.SEARCH, { legacyKeys: ['rank'] }),
      step('tour_discoveries', SCOPE.ACCOUNT),
      step('import_lesson', SCOPE.ACCOUNT),
    ]),
  }),
});

// The flow new onboarding sessions start in. Phase 2 moves this to 2 once its
// screens exist; sessions already in progress are carried across by
// beginOnboarding's step mapping.
export const CURRENT_ONBOARDING_VERSION = 1;

function flowFor(version) {
  return ONBOARDING_FLOWS[version] || ONBOARDING_FLOWS[CURRENT_ONBOARDING_VERSION];
}

const isIsoDate = (value) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isUuidish = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

// Accepts anything (a missing column, an older/hand-edited document) and
// returns a well-formed state. Unknown keys and invalid values are dropped
// rather than trusted, so stored state can never trap or break the flow.
export function normalizeOnboardingState(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const answers = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const context = input.context && typeof input.context === 'object' ? input.context : null;
  const knownKeys = new Set(Object.values(ONBOARDING_FLOWS).flatMap((flow) => flow.steps.map(({ key }) => key)));
  return {
    schema: ONBOARDING_STATE_SCHEMA,
    step: knownKeys.has(input.step) ? input.step : null,
    completed: Array.isArray(input.completed) ? [...new Set(input.completed.filter((key) => knownKeys.has(key)))] : [],
    answers: {
      ...(COLLABORATION_CHOICES.includes(answers.collaboration) ? { collaboration: answers.collaboration } : {}),
    },
    context: context && isUuidish(context.searchId) && ONBOARDING_ROLES.includes(context.role)
      ? { searchId: context.searchId, role: context.role }
      : null,
    startedAt: isIsoDate(input.startedAt) ? input.startedAt : null,
    updatedAt: isIsoDate(input.updatedAt) ? input.updatedAt : null,
    completedAt: isIsoDate(input.completedAt) ? input.completedAt : null,
  };
}

// The screens this person actually sees, given their answers and context.
export function onboardingStepsFor(version, rawState) {
  const state = normalizeOnboardingState(rawState);
  return flowFor(version).steps.filter((definition) => !definition.when || definition.when(state)).map(({ key }) => key);
}

function stepDefinition(version, key) {
  return flowFor(version).steps.find((definition) => definition.key === key) || null;
}

// Where to land: the stored step if it is still one this person sees,
// otherwise the first screen they haven't finished, otherwise the last.
export function resumeOnboardingStep(version, rawState) {
  const state = normalizeOnboardingState(rawState);
  const steps = onboardingStepsFor(version, state);
  if (state.step && steps.includes(state.step)) return state.step;
  return steps.find((key) => !state.completed.includes(key)) || steps[steps.length - 1];
}

export function onboardingProgress(version, rawState, currentStep) {
  const steps = onboardingStepsFor(version, rawState);
  const index = Math.max(0, steps.indexOf(currentStep));
  return { index, position: index + 1, total: steps.length, steps };
}

// An invited co-buyer is, by definition, searching with a co-buyer.
function impliedCollaboration(choice, role) {
  if (role !== 'co_buyer') return choice;
  if (choice === 'realtor' || choice === 'co_buyer_and_realtor') return 'co_buyer_and_realtor';
  return 'co_buyer';
}

// Called whenever /onboarding is opened by someone who hasn't finished.
// Returns the version and state to continue with and whether this is a
// fresh start, a resume, and whether it differs from what is stored.
//
// - A fresh start begins at the current version.
// - A session started on an older version continues in the current one,
//   carrying finished screens across via legacyKeys.
// - If the onboarding search changed since progress was made (e.g. the
//   person accepted a co-buyer invitation mid-way), search-scoped screens are
//   no longer counted as finished: their answers belong to the other search.
export function beginOnboarding({ storedVersion = null, storedState = null, context, now = new Date().toISOString(), targetVersion = CURRENT_ONBOARDING_VERSION }) {
  if (!context || !isUuidish(context.searchId) || !ONBOARDING_ROLES.includes(context.role)) {
    throw new Error('beginOnboarding requires the onboarding search context.');
  }
  const stored = normalizeOnboardingState(storedState);
  const fresh = !stored.startedAt;
  let completed = stored.completed;
  let currentStep = stored.step;

  if (!fresh && storedVersion && storedVersion !== targetVersion) {
    const mapKey = (key) => flowFor(targetVersion).steps.find((definition) => (definition.legacyKeys || []).includes(key))?.key || null;
    completed = completed.map(mapKey).filter(Boolean);
    currentStep = currentStep ? mapKey(currentStep) : null;
  }

  const searchChanged = Boolean(stored.context) && stored.context.searchId !== context.searchId;
  if (searchChanged) {
    completed = completed.filter((key) => stepDefinition(targetVersion, key)?.scope !== SCOPE.SEARCH);
    if (currentStep && stepDefinition(targetVersion, currentStep)?.scope === SCOPE.SEARCH) currentStep = null;
  }

  const state = {
    ...stored,
    completed,
    step: currentStep,
    answers: { ...stored.answers },
    context: { searchId: context.searchId, role: context.role },
    startedAt: stored.startedAt || now,
    completedAt: null,
  };
  const collaboration = impliedCollaboration(state.answers.collaboration, context.role);
  if (collaboration) state.answers.collaboration = collaboration;
  state.step = resumeOnboardingStep(targetVersion, state);

  const changed = fresh || storedVersion !== targetVersion || JSON.stringify(normalizeOnboardingState(storedState)) !== JSON.stringify(state);
  return { version: targetVersion, state: changed ? { ...state, updatedAt: now } : state, fresh, resumed: !fresh, changed, searchChanged };
}

// Records an onboarding-only answer. Changing who someone searches with only
// changes which screens are shown next; nothing already entered is discarded.
export function setOnboardingAnswer(rawState, key, value, now = new Date().toISOString()) {
  const state = normalizeOnboardingState(rawState);
  if (key !== 'collaboration' || !COLLABORATION_CHOICES.includes(value)) {
    throw new Error(`Unsupported onboarding answer: ${key}`);
  }
  if (state.context?.role === 'co_buyer' && !collaborationIncludes(value, 'co_buyer')) {
    throw new Error('An invited co-buyer is always searching with a co-buyer.');
  }
  return { ...state, answers: { ...state.answers, [key]: value }, updatedAt: now };
}

// Marks `fromStep` finished and moves to the next screen this person sees.
// `done` is true when there is no next screen (completion is then recorded
// by completeOnboardingState once onboarding_complete has been saved).
export function advanceOnboarding(version, rawState, fromStep, now = new Date().toISOString()) {
  const state = normalizeOnboardingState(rawState);
  const steps = onboardingStepsFor(version, state);
  const index = steps.indexOf(fromStep);
  if (index === -1) return { state: { ...state, step: resumeOnboardingStep(version, state) }, done: false };
  const completed = state.completed.includes(fromStep) ? state.completed : [...state.completed, fromStep];
  const next = steps[index + 1] || null;
  return { state: { ...state, completed, step: next || fromStep, updatedAt: now }, done: !next };
}

// Moves to the previous screen. Answers are never cleared by going back.
export function retreatOnboarding(version, rawState, fromStep, now = new Date().toISOString()) {
  const state = normalizeOnboardingState(rawState);
  const steps = onboardingStepsFor(version, state);
  const index = steps.indexOf(fromStep);
  const previous = index > 0 ? steps[index - 1] : steps[0];
  return { ...state, step: previous, updatedAt: now };
}

export function completeOnboardingState(version, rawState, now = new Date().toISOString()) {
  const state = normalizeOnboardingState(rawState);
  const steps = onboardingStepsFor(version, state);
  return { ...state, completed: [...new Set([...state.completed, ...steps])], completedAt: now, updatedAt: now };
}

// Finished onboarding before onboarding was versioned. Such accounts are
// never sent through a newer flow; new capabilities reach them in-product.
export function isLegacyOnboardedProfile(profile) {
  return Boolean(profile?.onboarding_complete) && (profile?.onboarding_version ?? null) === null;
}
