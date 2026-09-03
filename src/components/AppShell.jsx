'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';
import { TABS } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';

export default function AppShell({ children, userEmail }) {
  const pathname = usePathname();
  const router = useRouter();

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
          <button className="hh-btn hh-btn-ghost" onClick={signOut} style={{ fontSize: 12.5 }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>

        <div className="hh-tabs">
          {TABS.map(({ key, label, href, icon: Icon }) => (
            <Link key={key} href={href} className={`hh-tab ${pathname === href ? 'active' : ''}`}>
              <Icon size={14} /> {label}
            </Link>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
