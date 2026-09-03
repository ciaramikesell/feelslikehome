'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setStatus('loading');
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    if (resetError) {
      setStatus(null);
      setError(resetError.message || 'Could not send the reset email.');
      return;
    }
    setStatus('sent');
  };

  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link href="/auth/sign-in" className="afh-back-link" style={{ textDecoration: 'none' }}><ArrowLeft size={13} /> Back to sign in</Link>

        <div>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Reset your password</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '5px 0 0' }}>Enter your email and we'll send you a link to reset it.</p>
        </div>

        {status !== 'sent' ? (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="afh-label">Email</label>
              <input className="afh-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </div>
            {error && <Banner kind="error">{error}</Banner>}
            <button type="submit" className="afh-btn" disabled={status === 'loading'}>
              {status === 'loading' ? <><Spinner /> Sending...</> : 'Send reset link'}
            </button>
          </form>
        ) : (
          <Banner kind="success">We sent a password reset link to {email}. Open that email and click the link to choose a new password.</Banner>
        )}
      </div>
    </AuthShell>
  );
}
