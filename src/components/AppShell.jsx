'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Home as HomeIcon, Columns, HelpCircle, X, Footprints, SlidersHorizontal, Map } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { PRIMARY_TABS, MOBILE_PRIMARY_TABS } from '@/lib/constants';
import { homeVocabulary } from '@/lib/homePresentation';
import { createClient } from '@/lib/supabase/client';
import { savePriorities } from '@/lib/supabase/collaboration';
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
// even while drilled into a detail screen.
function MobileNav({ pathname, vocabulary }) {
  return (
    <nav className="hh-mobile-nav" aria-label="Primary navigation">
      {MOBILE_PRIMARY_TABS.map(({ key, label, href }) => {
        const Icon = TAB_ICONS[key];
        const presentationLabel = key === 'homes' ? vocabulary.plural : label;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={key} href={href} className={`hh-mobile-nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="hh-mobile-nav-icon"><Icon size={21} strokeWidth={active ? 2.3 : 2} aria-hidden="true" /></span>
            <span className="hh-mobile-nav-label">{presentationLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// One-time orientation for the mobile bottom nav, shown once per search per
// device class — see the mount effect in AppShell for the "mobile and not
// already dismissed" gate. All four steps show at once (no carousel/paging
// state to build or get stuck in); dismissing via the X or "Got it" are
// equivalent — either persists the same flag and never blocks navigation.
function MobileFirstTimeTour({ vocabulary, onDismiss }) {
  const steps = [
    { label: vocabulary.plural, icon: HomeIcon, body: `Your contenders live here. Add ${vocabulary.pluralLower} as you find them and keep everything in one place.` },
    { label: 'Tour', icon: Footprints, body: `Save the ${vocabulary.pluralLower} you want to see in person.` },
    { label: 'Compare', icon: Columns, body: 'See how your favorites stack up based on what matters to you.' },
    { label: 'Search', icon: SlidersHorizontal, body: "Update your priorities anytime — your Match scores update with them." },
  ];
  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}>
      <div className="hh-modal hh-corner" role="dialog" aria-modal="true" aria-labelledby="mobile-tour-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <h2 id="mobile-tour-title" className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>Getting around</h2>
          <button type="button" className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onDismiss} aria-label="Skip">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
          {steps.map((step) => (
            <div key={step.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: 'rgba(193,89,47,.09)', color: 'var(--brick)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <step.icon size={17} aria-hidden="true" />
              </span>
              <div>
                <div className="hh-serif" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{step.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, margin: '0 0 18px' }}>
          That&apos;s it. Add a {vocabulary.singularLower} and we&apos;ll take it from there.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="hh-btn" onClick={onDismiss}>Got it</button>
        </div>
      </div>
    </div>
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
  const [mobileTourOpen, setMobileTourOpen] = useState(false);
  const vocabulary = homeVocabulary(priorities);

  // Mobile-only, first-time-only: checked once after mount (never on resize —
  // rotating a phone mid-session shouldn't resurface a tutorial someone
  // already dismissed) against the same ~700px boundary the bottom nav
  // itself switches on. Starting closed keeps the first client render
  // identical to the server-rendered markup, so there's no hydration
  // mismatch — this only ever opens it, never on desktop.
  useEffect(() => {
    if (priorities?.mobileTourDismissed) return;
    if (window.matchMedia('(max-width: 700px)').matches) setMobileTourOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissMobileTour = () => {
    setMobileTourOpen(false);
    if (!activeSearchId) return;
    savePriorities(createClient(), { id: activeSearchId }, userId, { ...priorities, mobileTourDismissed: true }).catch(() => {});
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  return (
    <div className="hh-root">
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

      <MobileNav pathname={pathname} vocabulary={vocabulary} />

      {mobileTourOpen && <MobileFirstTimeTour vocabulary={vocabulary} onDismiss={dismissMobileTour} />}
      {howToOpen && <HowToUseModal onClose={() => setHowToOpen(false)} />}
      <BetaFeedback userId={userId} searchId={activeSearchId} searchType={searchIntent} appVersion={appVersion} />
    </div>
  );
}
