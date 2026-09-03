'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) { setError('Please enter both your email and password.'); return; }
    setStatus('loading');
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setStatus(null);
      setError(signInError.message || 'Invalid login credentials.');
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <AuthShell>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Sign in</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic', margin: '5px 0 0' }}>Pick up where you left off.</p>
        </div>

        <div>
          <label className="afh-label">Email</label>
          <input className="afh-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>

        <div>
          <PasswordField label="Password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <Link href="/auth/forgot-password" className="afh-link" style={{ textDecoration: 'none' }}>Forgot password?</Link>
          </div>
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        <button type="submit" className="afh-btn" disabled={status === 'loading'}>
          {status === 'loading' ? <><Spinner /> Signing in...</> : 'Sign in'}
        </button>

        <div className="afh-divider"><span>or</span></div>

        <Link href="/auth/sign-up" className="afh-btn afh-btn-ghost" style={{ textDecoration: 'none', textAlign: 'center' }}>Start your home search</Link>
      </form>
    </AuthShell>
  );
}
