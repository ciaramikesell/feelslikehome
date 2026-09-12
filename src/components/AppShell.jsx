'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Home as HomeIcon, Columns, HelpCircle, X, Footprints, SlidersHorizontal, Map } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { PRIMARY_TABS, MOBILE_PRIMARY_TABS } from '@/lib/constants';
import { homeVocabulary } from '@/lib/homePresentation';
import { createClient } from '@/lib/supabase/client';
import { isNativeApp } from '@/lib/platform';
import SearchSwitcher from '@/components/SearchSwitcher';
import BetaFeedback from '@/components/BetaFeedback';

const TAB_ICONS = {
  homes: HomeIcon,
  tour: Footprints,
  compare: Columns,
  map: Map,
  search: SlidersHorizontal,
};

// Narrow-viewport-only replacement for the desktop top tab bar — see
// .hh-mobile-nav / .hh-tabs in globals.css for the display toggle between
// them. A route is "active" for its own page and anything nested under it
// (e.g. /homes/[homeId] still highlights Homes), unlike the desktop tabs'
// exact-match check, since a fixed bottom bar needs to read as "where am I"
// even while drilled into a detail screen. `highlightKey` lights up one item
// during the first-run tour (see MobileFirstRunTour) — undefined/no match
// the rest of the time.
function MobileNav({ pathname, vocabulary, highlightKey }) {
  return (
    <nav className="hh-mobile-nav" aria-label="Primary navigation">
      {MOBILE_PRIMARY_TABS.map(({ key, label, href }) => {
        const Icon = TAB_ICONS[key];
        const presentationLabel = key === 'homes' ? vocabulary.plural : label;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={key} href={href} className={`hh-mobile-nav-item ${active ? 'active' : ''} ${key === highlightKey ? 'hh-tour-highlight' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="hh-mobile-nav-icon"><Icon size={21} strokeWidth={active ? 2.3 : 2} aria-hidden="true" /></span>
            <span className="hh-mobile-nav-label">{presentationLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Device-specific by design for V1 — see MOBILE_TOUR_DISMISS_KEY usage below.
const MOBILE_TOUR_DISMISS_KEY = 'flh-mobile-tour-dismissed';

// The four real nav items the tour walks through, in order. Map is
// intentionally excluded per product direction. Vocabulary-adaptive copy
// mirrors how the rest of the app never hardcodes "home" for apartment
// search types.
function mobileTourSteps(vocabulary) {
  return [
    { key: 'homes', label: vocabulary.plural, body: `Your contenders live here. Add ${vocabulary.pluralLower} as you find them and keep everything in one place.` },
    { key: 'tour', label: 'Tour', body: `Keep track of the ${vocabulary.pluralLower} you want to see.` },
    { key: 'compare', label: 'Compare', body: 'See where your strongest contenders differ.' },
    { key: 'search', label: 'Search', body: 'This is where what matters to you lives. Change it anytime.' },
  ];
}

// Contextual coach-mark tour, replacing the old full-page tutorial modal.
// The user stays on Homes the whole time (AppShell only renders this while
// pathname === '/homes' — see the gate below); each step highlights one real
// nav item via MobileNav's `highlightKey` and a small callout near it
// explains it, with the rest of the screen dimmed by a backdrop that sits
// below the nav's z-index so the nav itself stays undimmed. Step index is
// owned by AppShell (not here) because the highlight lives in a sibling
// component (MobileNav), not inside this one.
//
// Structured so a future "Replay mobile tour" control (e.g. from How to Use)
// only needs to clear MOBILE_TOUR_DISMISS_KEY and reset step to 0 — not
// built here, per scope, but nothing here stands in the way of it.
function MobileFirstRunTour({ vocabulary, step, onNext, onFinish }) {
  const steps = mobileTourSteps(vocabulary);
  const isFinal = step >= steps.length;
  const current = steps[step];

  return (
    <>
      <div className="hh-tour-backdrop" onMouseDown={onFinish} />
      {!isFinal && current && (
        <div className={`hh-tour-callout hh-tour-callout-${current.key}`} role="dialog" aria-modal="true" aria-labelledby="mobile-tour-step-title">
          <div id="mobile-tour-step-title" className="hh-serif" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{current.label}</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 12px' }}>{current.body}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '5px 9px' }} onClick={onFinish}>Skip</button>
            <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{step + 1} of {steps.length}</span>
            <button type="button" className="hh-btn" style={{ fontSize: 11.5, padding: '5px 11px' }} onClick={onNext}>Next</button>
          </div>
        </div>
      )}
      {isFinal && (
        <div className="hh-tour-callout hh-tour-callout-final" role="dialog" aria-modal="true" aria-labelledby="mobile-tour-final-title">
          <div id="mobile-tour-final-title" className="hh-serif" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>You&apos;re ready.</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 14px' }}>Add a {vocabulary.singularLower} and we&apos;ll take it from there.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="hh-btn" style={{ fontSize: 12.5, padding: '6px 13px' }} onClick={onFinish}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

// Plain-language explanation of the whole workflow. Purely presentational — no
// database field, no localStorage, nothing persisted; the modal just closes on
// its own state, so a returning user who already knows the app can ignore it.
const HOW_TO_STEPS = [
  { title: 'Find homes wherever you already look', body: 'Start on Zillow, Realtor, Homes.com, builder websites, rental sites — wherever you normally search. Feels Like Home is not a listing-search engine.' },
  { title: 'Bring the contenders here', body: "Add the homes you're actually considering. We'll keep them together and help you see how each lines up with what matters to you. Map is another view of the homes already in your search." },
  { title: "Decide what's worth seeing", body: 'Favorite the standouts and use Want to Tour to narrow the field. Fewer tabs, better contenders.' },
  { title: 'Go see them', body: "Pictures only tell you so much. A house can check every box and still not feel like home." },
  { title: 'Tell us how it actually felt', body: "After touring, record Overall Feeling and weigh in on the light, flow, and other things a listing couldn't really tell you." },
  { title: 'Compare the survivors', body: "At some point, you're not looking for more homes — you're choosing between the right ones. Use Compare when the question becomes, “Which of these is actually right for me?”" },
];

function HowToUseModal({ onClose }) {
  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner hh-how-to" role="dialog" aria-modal="true" aria-labelledby="how-to-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h2 id="how-to-title" className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>How Feels Like Home works</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, margin: '4px 0 18px' }}>
          You found the homes. We&apos;ll help you choose.
        </p>

        <div className="hh-how-to-steps">
          {HOW_TO_STEPS.map((step, i) => (
            <div key={step.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                className="hh-mono"
                style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--brick)', color: '#fff',
                  fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <div>
                <div className="hh-serif" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="hh-how-to-notes">
          <section>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brick)', marginBottom: 4 }}>Match on paper</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
            <strong>Match shows how the known information about a home lines up with your priorities.</strong> Higher-importance preferences count more, and unknown details aren&apos;t treated as misses. It&apos;s a useful on-paper view — not a prediction of whether you&apos;ll love the home. Overall Feeling stays separate because that comes from being there.
          </p>
          </section>
          <section>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--moss)', marginBottom: 4 }}>Searching together</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
              <strong>The house is ours. The opinion is mine. The conversation is shared.</strong> People in a shared search can see each other&apos;s search-specific priorities and opinions, but only their author can change them. Each person keeps an independent Match and Overall Feeling—there is no combined score or winner.
            </p>
          </section>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="hh-btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children, userEmail, userId, accessibleSearches, activeSearchId, priorities, searchIntent, appVersion }) {
  const pathname = usePathname();
  const router = useRouter();
  const [howToOpen, setHowToOpen] = useState(false);
  const [tourDismissed, setTourDismissed] = useState(true);
  const [tourEligibleDevice, setTourEligibleDevice] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [native, setNative] = useState(false);
  const vocabulary = homeVocabulary(priorities);

  // Centralizes the one native-vs-web chrome difference this shell needs —
  // the installed app has no browser UI pushing content below the status
  // bar/notch, so its header needs its own safe-area-top padding (see
  // .hh-native .hh-app-header in globals.css). Everything else about the
  // header/tabs/nav is identical between native and mobile web.
  useEffect(() => { if (isNativeApp()) setNative(true); }, []);

  // Reads localStorage once after mount — same mechanism and key style as
  // InstallPrompt's install-banner dismissal (flh-install-dismissed) — rather
  // than the search-priorities JSONB round trip this used previously. That
  // approach could reappear right after being dismissed: the write was an
  // async, fire-and-forget save, and a navigation immediately afterward could
  // re-fetch server-side priorities before the write had committed, showing
  // the tour again. A synchronous, local, per-device flag has no such race,
  // survives refresh trivially, and the product direction explicitly accepts
  // device/browser-specific dismissal for V1 — no schema/migration involved
  // either way. Viewport is also checked only once here, not on resize.
  useEffect(() => {
    let dismissed = true;
    try { dismissed = localStorage.getItem(MOBILE_TOUR_DISMISS_KEY) === '1'; } catch { dismissed = true; }
    setTourDismissed(dismissed);
    setTourEligibleDevice(window.matchMedia('(max-width: 700px)').matches);
  }, []);

  // The tour only ever shows on the Homes screen (per product direction —
  // the user learns the real nav without leaving it), so navigating away
  // simply unmounts it; navigating back before finishing starts over at step
  // 0, which is fine for something this short-lived.
  const tourOpen = tourEligibleDevice && !tourDismissed && pathname === '/homes';
  useEffect(() => { if (tourOpen) setTourStep(0); }, [tourOpen]);

  const finishTour = () => {
    setTourDismissed(true);
    try { localStorage.setItem(MOBILE_TOUR_DISMISS_KEY, '1'); } catch { /* best-effort; never blocks dismissal */ }
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  return (
    <div className={`hh-root ${native ? 'hh-native' : ''}`}>
      <div className="hh-app-frame">
        <header className="hh-app-header">
          <div className="hh-brand-lockup">
            <BrandMark size={38} />
            <div className="hh-brand-copy">
              <Wordmark size={31} />
              {userEmail && <p className="hh-user-email">{userEmail}</p>}
            </div>
          </div>
          <div className="hh-shell-utilities">
            {accessibleSearches && accessibleSearches.length > 1 && (
              <SearchSwitcher userId={userId} searches={accessibleSearches} activeSearchId={activeSearchId} />
            )}
            <Link
              href="/search"
              className={`hh-shell-action hh-shell-action-primary hh-desktop-only ${pathname === '/search' ? 'active' : ''}`}
            >
              <SlidersHorizontal size={14} /> My Search
            </Link>
            <button className="hh-shell-action" onClick={() => setHowToOpen(true)}>
              <HelpCircle size={14} /> How to use
            </button>
            <button className="hh-shell-action hh-shell-action-quiet" onClick={signOut}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </header>

        <nav className="hh-tabs" aria-label="Primary navigation">
          {PRIMARY_TABS.map(({ key, label, href }) => {
            const Icon = TAB_ICONS[key];
            const presentationLabel = key === 'homes' ? vocabulary.plural : label;
            return (
              <Link key={key} href={href} className={`hh-tab ${pathname === href ? 'active' : ''}`}>
                <Icon size={14} /> {presentationLabel}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>

      <MobileNav pathname={pathname} vocabulary={vocabulary} highlightKey={tourOpen ? mobileTourSteps(vocabulary)[tourStep]?.key : undefined} />

      {tourOpen && (
        <MobileFirstRunTour
          vocabulary={vocabulary}
          step={tourStep}
          onNext={() => setTourStep((s) => s + 1)}
          onFinish={finishTour}
        />
      )}
      {howToOpen && <HowToUseModal onClose={() => setHowToOpen(false)} />}
      <BetaFeedback userId={userId} searchId={activeSearchId} searchType={searchIntent} appVersion={appVersion} />
    </div>
  );
}
