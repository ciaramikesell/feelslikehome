// Product analytics boundary.
//
// FLH has no analytics vendor and this file deliberately adds none. Product
// code calls track(); where events go is decided by sinks registered at the
// edge (none by default, plus a console sink in development). A future sink —
// a first-party insert-only events table, or a vendor — plugs in without
// touching call sites.
//
// Privacy by construction: only listed event names are accepted, and only
// allowlisted property keys with short primitive values survive. Listing URLs,
// addresses, emails, names, notes, tokens, and free text can't be attached,
// because no allowed key carries them.
//
// track() never throws and never blocks: analytics must not be able to break
// onboarding, imports, or purchases.

export const ANALYTICS_EVENTS = Object.freeze({
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_RESUMED: 'onboarding_resumed',
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  // Derived later from the last viewed step of sessions that never
  // complete; listed so every sink shares one vocabulary.
  ONBOARDING_ABANDONED: 'onboarding_abandoned',
  COLLABORATION_TYPE_SELECTED: 'collaboration_type_selected',
  LOCATION_ADDED: 'location_added',
  PRIORITY_ADDED: 'priority_added',
  FIRST_HOME_IMPORTED: 'first_home_imported',
  SECOND_HOME_IMPORTED: 'second_home_imported',
  MATCH_VIEWED: 'match_viewed',
  COMPARE_ATTEMPTED: 'compare_attempted',
  COLLABORATOR_INVITED: 'collaborator_invited',
  COLLABORATOR_JOINED: 'collaborator_joined',
  PAYWALL_VIEWED: 'paywall_viewed',
  PAYWALL_DISMISSED: 'paywall_dismissed',
  FLH_PLUS_PURCHASE_STARTED: 'flh_plus_purchase_started',
  FLH_PLUS_PURCHASED: 'flh_plus_purchased',
  FLH_PLUS_PURCHASE_FAILED: 'flh_plus_purchase_failed',
  SHARE_EXTENSION_HELP_VIEWED: 'share_extension_help_viewed',
  GET_STARTED_TASK_COMPLETED: 'get_started_task_completed',
});

const EVENT_NAMES = new Set(Object.values(ANALYTICS_EVENTS));

// Every property any event may carry. Add a key here (with a reason) before
// using it; anything else is silently dropped.
export const ANALYTICS_PROPERTY_KEYS = Object.freeze([
  'flow_version', // onboarding flow version
  'step', // onboarding step key, e.g. 'basics'
  'position', // 1-based position of a step among the screens shown
  'total', // number of screens shown
  'role', // participant role: owner | co_buyer | realtor
  'collaboration', // solo | co_buyer | realtor | co_buyer_and_realtor
  'search_changed', // resume moved to a different search
  'search_intent', // purchase | rental | investment
  'surface', // where in the product, e.g. 'onboarding'
  'trigger', // what prompted a paywall / prompt
  'reason', // short machine reason code
  'source', // listing source family, e.g. 'zillow' (never the URL)
  'count', // a small count (homes, priorities, areas)
  'task', // Get Started task key
  'platform', // ios | web
  'result', // short outcome code
]);
const PROPERTY_KEYS = new Set(ANALYTICS_PROPERTY_KEYS);
const MAX_STRING = 64;

function sanitizeProperties(properties) {
  const clean = {};
  if (!properties || typeof properties !== 'object') return clean;
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTY_KEYS.has(key)) continue;
    if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING && /^[\w.:-]+$/.test(value)) clean[key] = value;
  }
  return clean;
}

const sinks = new Set();

// Registers a sink: (event) => void, where event is
// { name, properties, occurredAt }. Returns an unregister function.
export function registerAnalyticsSink(sink) {
  if (typeof sink !== 'function') throw new TypeError('An analytics sink must be a function.');
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function track(name, properties = {}) {
  if (!EVENT_NAMES.has(name)) {
    if (process.env.NODE_ENV !== 'production') console.warn(`[analytics] unknown event "${name}" dropped`);
    return null;
  }
  const event = Object.freeze({ name, properties: Object.freeze(sanitizeProperties(properties)), occurredAt: new Date().toISOString() });
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // A failing sink must never affect the product or other sinks.
    }
  }
  return event;
}

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  registerAnalyticsSink((event) => console.debug('[analytics]', event.name, event.properties));
}
