'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim() || !confirm.trim()) { setError('Please fill in every field.'); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6) { setError('Password should be at least 6 characters.'); return; }
    setStatus('loading');
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/` },
    });
    if (signUpError) {
      setStatus(null);
      setError(signUpError.message || 'Could not create your account.');
      return;
    }
    if (data.session) {
      // This project has email confirmation turned off, so signUp already returned a
      // live session — take the new user straight into onboarding.
      router.push('/');
      router.refresh();
    } else {
      // Email confirmation is required — Supabase already sent the confirmation link.
      setStatus('check-email');
    }
  };

  if (status === 'check-email') {
    return (
      <AuthShell>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Check your email</h2>
          <Banner kind="success">We sent a confirmation link to {email}. Click it to finish creating your account, then come back and sign in.</Banner>
          <Link href="/auth/sign-in" className="afh-btn afh-btn-ghost" style={{ textDecoration: 'none', textAlign: 'center' }}>Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link href="/auth/sign-in" className="afh-back-link" style={{ textDecoration: 'none' }}><ArrowLeft size={13} /> Back to sign in</Link>

        <div>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Start your home search</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '5px 0 0' }}>Create your account to start comparing homes.</p>
        </div>

        <div>
          <label className="afh-label">Email</label>
          <input className="afh-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <PasswordField label="Password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" autoComplete="new-password" />

        {error && <Banner kind="error">{error}</Banner>}

        <button type="submit" className="afh-btn" disabled={status === 'loading'}>
          {status === 'loading' ? <><Spinner /> Creating account...</> : 'Start your home search'}
        </button>
      </form>
    </AuthShell>
  );
}
