import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANALYTICS_EVENTS, registerAnalyticsSink, track } from '../src/lib/analytics.js';

function capture() {
  const events = [];
  const stop = registerAnalyticsSink((event) => events.push(event));
  return { events, stop };
}

test('the event vocabulary covers the onboarding V2 / FLH+ learning plan', () => {
  for (const name of ['onboarding_started', 'onboarding_step_completed', 'onboarding_completed', 'onboarding_abandoned',
    'collaboration_type_selected', 'location_added', 'priority_added', 'first_home_imported', 'second_home_imported',
    'match_viewed', 'compare_attempted', 'collaborator_invited', 'collaborator_joined', 'paywall_viewed', 'paywall_dismissed',
    'flh_plus_purchase_started', 'flh_plus_purchased', 'flh_plus_purchase_failed', 'share_extension_help_viewed',
    'get_started_task_completed']) {
    assert.ok(Object.values(ANALYTICS_EVENTS).includes(name), name);
  }
});

test('events reach every registered sink, and unregistering stops delivery', () => {
  const a = capture();
  const b = capture();
  track(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, { flow_version: 1 });
  assert.equal(a.events.length, 1);
  assert.equal(b.events[0].name, 'onboarding_completed');
  assert.match(b.events[0].occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  a.stop();
  track(ANALYTICS_EVENTS.ONBOARDING_COMPLETED);
  assert.equal(a.events.length, 1);
  assert.equal(b.events.length, 2);
  b.stop();
});

test('unknown event names are dropped, not invented', () => {
  const { events, stop } = capture();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(track('home_address_entered', { step: 'basics' }), null);
  } finally {
    console.warn = warn;
    stop();
  }
  assert.deepEqual(events, []);
});

test('only allowlisted, short, primitive properties survive — no URLs, addresses, emails, names, or free text', () => {
  const { events, stop } = capture();
  track(ANALYTICS_EVENTS.FIRST_HOME_IMPORTED, {
    source: 'zillow',
    count: 1,
    step: 'basics',
    resumed: true, // not an allowlisted key
    listingUrl: 'https://www.zillow.com/homedetails/1-Main-St/1_zpid/',
    address: '1 Main St',
    email: 'buyer@example.com',
    name: 'Ciara',
    reason: 'https://evil.example/?q=1', // allowed key, but not a short code
    result: 'x'.repeat(65),
    total: Number.NaN,
    surface: { nested: 'object' },
  });
  stop();
  assert.deepEqual(events[0].properties, { source: 'zillow', count: 1, step: 'basics' });
});

test('a failing sink can never break the product or other sinks', () => {
  const stopBroken = registerAnalyticsSink(() => { throw new Error('vendor down'); });
  const { events, stop } = capture();
  assert.doesNotThrow(() => track(ANALYTICS_EVENTS.MATCH_VIEWED, { count: 3 }));
  assert.equal(events.length, 1);
  stopBroken();
  stop();
});

test('no third-party analytics dependency was introduced', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(deps.filter((dep) => /analytics|segment|mixpanel|posthog|amplitude|gtag|heap|rudder/i.test(dep)), []);
});

