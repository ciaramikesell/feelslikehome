'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/ui';

// Root error boundary. Catches anything thrown by a Server Component below
// the root layout — most importantly (app)/layout.js's per-request Supabase
// reads (profile/active search/priorities), which have no try/catch of their
// own and run on every navigation into the app *and* on every router.refresh()
// (e.g. right after a successful Add Home save). A transient upstream hiccup
// there used to fall through to Next's generic, unstyled default error page.
// error.js cannot catch a throw from a layout.js in its own segment, so this
// has to live at the root, one level above (app)/layout.js, to actually catch it.
//
// Next.js already strips the real error message/stack for a Server Component
// error in production and replaces it with a generic one (only `digest`
// survives, for log correlation) — so logging `error` here is safe as-is;
// nothing infrastructure-specific (status codes, provider names, hosting
// platform) is ever shown to the user.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled app error', error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 16, padding: '24px 20px', textAlign: 'center', background: 'var(--paper)',
      }}
    >
      <BrandMark size={40} />
      <div>
        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
          Something didn&apos;t load right.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          Try again, or head back to your homes.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="hh-btn" onClick={() => reset()}>Try again</button>
        <Link href="/homes" className="hh-btn hh-btn-ghost">Back to Homes</Link>
      </div>
    </div>
  );
}
