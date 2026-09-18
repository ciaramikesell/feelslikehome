import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const publicLanding = read('src/components/PublicLanding.jsx');
const flhCards = read('src/components/FlhPlusCards.jsx');
const flhLanding = read('src/components/FlhPlusLanding.jsx');
const flhPage = read('src/app/flh-plus/page.js');
const rootPage = read('src/app/page.js');
const rootPageComponent = read('src/app/page.js');
const authForm = read('src/components/auth/AuthForm.jsx');
const realtorLanding = read('src/components/RealtorLanding.jsx');
const css = read('src/app/globals.css');

test('the public homepage still renders PublicLanding for signed-out users with no auth requirement', () => {
  assert.match(rootPageComponent, /if \(!user\) return <PublicLanding \/>/);
});

test('signed-in root routing is untouched by this pass', () => {
  assert.match(rootPage, /account_entry_intent === 'realtor'\) redirect\('\/realtor'\)/);
  assert.match(rootPage, /redirect\('\/onboarding'\)/);
  assert.match(rootPage, /redirect\('\/homes'\)/);
});

test('auth continuation (sign-in/sign-up popover, redirect params) is untouched', () => {
  assert.match(publicLanding, /import LandingAuthPopover from/);
  assert.match(publicLanding, /openAuth\('sign-in', event\)/);
  assert.match(publicLanding, /openAuth\('sign-up', event\)/);
  assert.match(publicLanding, /<LandingAuthPopover mode=\{authMode\} onModeChange=\{setAuthMode\} onClose=\{closeAuth\} returnFocusRef=\{authTriggerRef\} \/>/);
  // Sign-up/sign-in hrefs still point at the real auth routes, not the new
  // FLH+ page — FLH+ never intercepts the auth flow.
  assert.match(publicLanding, /href="\/auth\/sign-up"/);
  assert.match(publicLanding, /href="\/auth\/sign-in"/);
});

test('desktop nav includes FLH+ in the specified order: How it works, FLH+, For Realtors, Sign in, Get started', () => {
  const navBlock = publicLanding.match(/<div className="pl-nav-surface">[\s\S]*?<\/div>/)?.[0] || '';
  const order = [...navBlock.matchAll(/>(How it works|FLH\+|For Realtors|Sign in)</g)].map((m) => m[1]);
  assert.deepEqual(order, ['How it works', 'FLH+', 'For Realtors', 'Sign in']);
  assert.match(publicLanding, /<Link href="\/flh-plus">FLH\+<\/Link>/);
});

test('mobile nav and footer also include FLH+ without breaking existing links', () => {
  const mobileNavBlock = publicLanding.match(/aria-label="Mobile public navigation">[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(mobileNavBlock, /<Link href="\/flh-plus">FLH\+<\/Link>/);
  assert.match(mobileNavBlock, /href={realtorHref}/);
  const footerNav = publicLanding.match(/aria-label="Footer navigation">[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(footerNav, /<Link href="\/flh-plus">FLH\+<\/Link>/);
});

test('the hero is unchanged — same headline, copy, CTAs, and imagery', () => {
  assert.match(publicLanding, /REAL ESTATE, REIMAGINED|Real estate, reimagined/i);
  assert.match(publicLanding, /You.ve saved a lot of options\./);
  assert.match(publicLanding, /Feels Like Home\.<\/em>/);
  assert.match(publicLanding, /src="\/images\/Warm Cottage\.png"/);
  assert.match(publicLanding, /Create a free account/);
  assert.match(publicLanding, /See how it works/);
});

test('How It Works keeps its four existing steps and adds only a restrained FLH+ badge to Search Together', () => {
  assert.match(publicLanding, /'Set Your Preferences'/);
  assert.match(publicLanding, /'Bring Homes From Anywhere'/);
  assert.match(publicLanding, /'Compare What Matters'/);
  assert.match(publicLanding, /'Search Together', 'Bring your co-buyer and Realtor into the same search while everyone keeps their own perspective\.', 'FLH\+'/);
  assert.match(publicLanding, /\{badge && <span className="pl-step-badge">\{badge\}<\/span>\}/);
  // Only Search Together carries a badge — the array literal shows exactly
  // one 4-element (badge-carrying) entry among the four steps.
  const stepEntries = publicLanding.match(/\[[A-Za-z]+, '[^']+', '[^']+'(, '[^']+')?\]/g) || [];
  assert.equal(stepEntries.length, 4);
  assert.equal(stepEntries.filter((s) => s.split(",").length === 4).length, 1);
});

test('the Match/demo section (Real Homes. Your Priorities.) is untouched', () => {
  assert.match(publicLanding, /Real homes\. Your priorities\./);
  assert.match(publicLanding, /Personalized Match Scores<\/li>/);
  assert.match(publicLanding, /Built for buyers, co-buyers, and Realtors<\/li>/);
  assert.match(publicLanding, /src="\/images\/FLH Example\.png"/);
});

test('the new FLH+ bridge section sits after the demo section and before the collaboration section', () => {
  const demoIndex = publicLanding.indexOf('pl-demo"');
  const bridgeIndex = publicLanding.indexOf('pl-flh-bridge"');
  const collabIndex = publicLanding.indexOf('pl-collaboration"');
  assert.ok(demoIndex > -1 && bridgeIndex > -1 && collabIndex > -1);
  assert.ok(demoIndex < bridgeIndex && bridgeIndex < collabIndex, 'FLH+ bridge must be between the demo and collaboration sections');
});

test('FLH+ bridge headline and copy match the approved content, with $7.99 once emphasized', () => {
  assert.match(publicLanding, /Start for free/);
  assert.match(publicLanding, /Start with three homes\.<br \/>Keep going for <em>\$7\.99 once\.<\/em>/);
  assert.match(publicLanding, /Feels Like Home is free for your first three contenders/);
  assert.match(publicLanding, /Learn more about FLH\+/);
  assert.match(publicLanding, /href="\/flh-plus">Learn more about FLH\+/);
});

test('Free card presents $0 and caps at 3 homes, never framed as a trial or degraded product', () => {
  assert.match(flhCards, />Free<\/h3>/);
  assert.match(flhCards, /\$0/);
  assert.match(flhCards, /Compare up to 3 homes/);
  assert.match(flhCards, /Perfect for narrowing down your first few contenders/);
  assert.doesNotMatch(flhCards, /\btrial\b|not a real search|limited version/i);
});

test('FLH+ card presents $7.99 as a clearly one-time purchase, never monthly/recurring', () => {
  assert.match(flhCards, />FLH\+<\/h3>/);
  assert.match(flhCards, /\$7\.99 <span>once<\/span>/);
  assert.match(flhCards, /Unlimited homes/);
  assert.match(flhCards, /Invite a co-buyer/);
  assert.match(flhCards, /Connect your Realtor/);
  assert.match(flhCards, /One purchase unlocks the search for everyone you invite/);
  assert.doesNotMatch(flhCards, /\bmonthly\b|\bper month\b|\bper user\b|\bsubscription\b/i);
});

test('the FLH+ card never implies Match/preferences are combined or averaged across participants', () => {
  assert.match(flhCards, /each person keeps their own Match/);
  assert.doesNotMatch(flhCards, /household match|combined match|average.{0,15}match/i);
});

test('collaboration section language stays intact: distinct Match, Unknown stays Unknown, no averaging, and gains a restrained FLH+ footnote', () => {
  assert.match(publicLanding, /Thoughtful collaboration · FLH\+/);
  assert.match(publicLanding, /Choosing a home doesn.t happen alone\./);
  assert.match(publicLanding, /Each person keeps their own Match, preferences, and perspective\. Unknown information stays Unknown\./);
  assert.match(publicLanding, /92% Match/);
  assert.match(publicLanding, /84% Match/);
  assert.match(publicLanding, /Both are included with FLH\+\. Your co-buyer and Realtor don&apos;t pay separately\./);
  assert.match(publicLanding, /href="\/flh-plus">Explore FLH\+/);
});

test('the Realtor example still shows professional context, not a buyer Match or buyer decision-making', () => {
  assert.match(publicLanding, /Suggested by Whitney/);
  assert.match(publicLanding, /Realtor contribution/);
  assert.match(publicLanding, /while your decisions stay yours/);
  assert.doesNotMatch(publicLanding, /Whitney.{0,30}% Match/);
});

test('no dark closing sales/pricing band was added after the collaboration section — the page ends and flows straight into the footer', () => {
  const afterCollaboration = publicLanding.slice(publicLanding.lastIndexOf('pl-collaboration-footnote'));
  assert.match(afterCollaboration, /<\/section>\s*<\/main>\s*<footer/);
});

test('Realtor public landing page and its navigation are untouched by this pass', () => {
  assert.match(realtorLanding, /For real estate professionals/i);
  assert.match(realtorLanding, /Start helping a buyer/);
  // RealtorLanding already had one restrained FLH+ mention from the prior
  // copy pass ("Realtor accounts are free...") — this pass must not add
  // more of them or alter the page.
  assert.equal((realtorLanding.match(/FLH\+/g) || []).length, 1);
});

test('FLH+ nav/footer/bridge links route to a real, implemented /flh-plus page — not a dead link or fake checkout', () => {
  assert.match(flhPage, /export default async function FlhPlusPage/);
  assert.match(flhPage, /<FlhPlusLanding isAuthenticated=\{Boolean\(user\)\} \/>/);
  assert.doesNotMatch(flhPage, /stripe|checkout\.session|payment_intent/i);
  assert.doesNotMatch(flhLanding, /stripe|checkout\.session|payment_intent/i);
  assert.doesNotMatch(flhLanding, /<button[^>]*>\s*(Buy|Purchase|Pay)\b/i);
});

test('the /flh-plus page reuses the same shared pricing cards as the homepage — no duplicated/diverging copy', () => {
  assert.match(flhLanding, /import FlhPlusCards from '@\/components\/FlhPlusCards'/);
  assert.match(flhLanding, /<FlhPlusCards className="flh-page-cards-grid" \/>/);
  assert.match(flhLanding, /nothing to renew or cancel/);
});

test('no accidental subscription/monthly/recurring wording anywhere in the updated homepage or new FLH+ surfaces', () => {
  const banned = /\bsubscription\b(?!.{0,3}$)|\bmonthly\b|\bper month\b|\brecurring\b|\bauto-renew/i;
  for (const [name, content] of [['PublicLanding.jsx', publicLanding], ['FlhPlusCards.jsx', flhCards]]) {
    assert.doesNotMatch(content, /\bmonthly\b|\bper month\b|\brecurring\b|\bauto-renew/i, `${name} has banned wording`);
  }
  // FlhPlusLanding legitimately says "not a subscription" once, to state the
  // negative explicitly — never an affirmative/recurring claim.
  assert.doesNotMatch(flhLanding, /(?<!not a )\bsubscription\b/i);
  assert.doesNotMatch(flhLanding, /\bmonthly\b|\bper month\b|\brecurring\b|\bauto-renew/i);
});

test('responsive: the FLH+ bridge collapses to a single column on mobile with no duplicated CTA markup', () => {
  assert.match(css, /@media \(max-width: 900px\) \{\s*\n\s*\.pl-flh-bridge \{ grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 640px\) \{\s*\n\s*\.pl-flh-bridge \{ width: calc\(100% - 32px\);/);
  // Only one "Learn more about FLH+" link exists in the bridge section (no
  // separate mobile-only duplicate the way the header/footer intentionally
  // have desktop/mobile pairs for auth).
  const bridgeSection = publicLanding.match(/<section className="pl-flh-bridge"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((bridgeSection.match(/Learn more about FLH\+/g) || []).length, 1);
});

test('responsive: pricing cards stack to one column on small screens without being squeezed side-by-side', () => {
  assert.match(css, /\.flh-cards \{ grid-template-columns: 1fr; gap: 16px; \}/);
});
