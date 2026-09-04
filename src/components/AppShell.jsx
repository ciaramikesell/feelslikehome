'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Home as HomeIcon, Columns, HelpCircle, X, Footprints, SlidersHorizontal } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { PRIMARY_TABS } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';

const TAB_ICONS = {
  homes: HomeIcon,
  tour: Footprints,
  compare: Columns,
};

// Plain-language explanation of the whole workflow. Purely presentational — no
// database field, no localStorage, nothing persisted; the modal just closes on
// its own state, so a returning user who already knows the app can ignore it.
const HOW_TO_STEPS = [
  { title: "Find homes wherever you normally search", body: 'Use Zillow, Realtor.com, Homes.com, Redfin, a builder website, or anywhere else you like to look for homes.' },
  { title: "Add the homes you're considering", body: "Copy the listing link and paste it into Feels Like Home, or enter the home's address. We'll fill in whatever property details we can." },
  { title: 'Add what you already know', body: "Add a photo and anything else you know about the home. You can also keep notes, pros, and cons so you don't have to remember everything yourself." },
  { title: 'Want to tour a home', body: "When one's worth seeing in person, tap Want to tour. It'll show up on your Want to Tour page." },
  { title: 'Tell us how it felt', body: "After you've seen it, tap I toured this home and choose Love it, Still considering, or Not for me — then optionally rate the things a listing can't tell you, like how it felt, the light, the layout." },
  { title: 'Your favorites collect themselves', body: 'Choosing Love it after a tour automatically favorites a home — or tap the heart on any home yourself.' },
  { title: "Archive homes you've ruled out", body: "Choosing Not for me (or archiving anytime) keeps your notes and ratings so you can remember why you passed — and you can restore the home later if you change your mind." },
  { title: 'Compare your finalists', body: "When you've narrowed it down, use Compare to put your top homes side by side and see how they measure up to what matters most to you." },
];

function HowToUseModal({ onClose }) {
  return (
    <div className="hh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hh-modal hh-corner" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h2 className="hh-serif" style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>How Feels Like Home works</h2>
          <button className="hh-btn hh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, margin: '4px 0 18px' }}>
          You find the homes. Feels Like Home helps you choose between them.
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
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: 'rgba(193,89,47,0.07)', border: '1px solid rgba(193,89,47,0.25)', borderRadius: 14, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brick)', marginBottom: 4 }}>The important part</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
            Feels Like Home doesn't replace the sites where you search for homes. Find homes wherever you already look, then bring the ones you're considering here to remember, rate, compare, and choose.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="hh-btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children, userEmail }) {
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
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <BrandMark size={38} />
            <div>
              <Wordmark size={31} />
              {userEmail && <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '4px 0 0' }}>{userEmail}</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href="/search"
              className="hh-btn hh-btn-ghost"
              style={{ fontSize: 12.5, color: pathname === '/search' ? 'var(--brick)' : undefined }}
            >
              <SlidersHorizontal size={14} /> My Search
            </Link>
            <button className="hh-btn hh-btn-ghost" onClick={() => setHowToOpen(true)} style={{ fontSize: 12.5 }}>
              <HelpCircle size={14} /> How to use
            </button>
            <button className="hh-btn hh-btn-ghost" onClick={signOut} style={{ fontSize: 12.5 }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>

        <div className="hh-tabs">
          {PRIMARY_TABS.map(({ key, label, href }) => {
            const Icon = TAB_ICONS[key];
            return (
              <Link key={key} href={href} className={`hh-tab ${pathname === href ? 'active' : ''}`}>
                <Icon size={14} /> {label}
              </Link>
            );
          })}
        </div>

        {children}
      </div>

      {howToOpen && <HowToUseModal onClose={() => setHowToOpen(false)} />}
    </div>
  );
}
