'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Home as HomeIcon, Columns, HelpCircle, X, Footprints, SlidersHorizontal, Map } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { PRIMARY_TABS } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import SearchSwitcher from '@/components/SearchSwitcher';
import BetaFeedback from '@/components/BetaFeedback';

const TAB_ICONS = {
  homes: HomeIcon,
  tour: Footprints,
  compare: Columns,
  map: Map,
};

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
      <div className="hh-modal hh-corner hh-how-to" style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>How Feels Like Home works</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, margin: '4px 0 18px' }}>
          You found the homes. We&apos;ll help you choose.
        </p>

        <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
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
            Match shows how the known information about a home lines up with your priorities. Higher-importance preferences count more, and unknown details aren&apos;t treated as misses. It&apos;s a useful on-paper view — not a prediction of whether you&apos;ll love the home. Overall Feeling stays separate because that comes from being there.
          </p>
          </section>
          <section>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--moss)', marginBottom: 4 }}>Searching together</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
              The house is ours. The opinion is mine. You can share one pool of homes while each person keeps their own priorities and opinions. We may celebrate safe shared moments — like a mutual favorite or both wanting to tour — but there is no combined Couple Match.
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

export default function AppShell({ children, userEmail, userId, accessibleSearches, activeSearchId, searchIntent, appVersion }) {
  const pathname = usePathname();
  const router = useRouter();
  const [howToOpen, setHowToOpen] = useState(false);

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
              className={`hh-shell-action hh-shell-action-primary ${pathname === '/search' ? 'active' : ''}`}
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
            return (
              <Link key={key} href={href} className={`hh-tab ${pathname === href ? 'active' : ''}`}>
                <Icon size={14} /> {label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>

      {howToOpen && <HowToUseModal onClose={() => setHowToOpen(false)} />}
      <BetaFeedback userId={userId} searchId={activeSearchId} searchType={searchIntent} appVersion={appVersion} />
    </div>
  );
}
