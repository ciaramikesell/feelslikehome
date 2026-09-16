'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';

// Distinct from AuthShell's own "welcome back" default — a new visitor
// hasn't been here before, so Sign Up gets its own editorial framing
// instead of inheriting Sign In's copy.
const SIGN_UP_HEADLINE = <>Start with the homes<br />you&apos;re already considering.</>;
const SIGN_UP_DESCRIPTION = 'Bring your contenders together and compare them against what actually matters to you.';

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `intent` is entry context, not an account role. Realtor permissions stay
  // relationship-scoped and are granted only by accepting a client invite.
  const isRealtorEntry = searchParams.get('intent') === 'realtor';
  // See sign-in's identical comment: validated so a crafted `?redirect=`
  // can't be used to send a freshly-created account off-site.
  const redirectTo = sanitizeRedirectPath(searchParams.get('redirect')) || '/';
  const entryDestination = redirectTo === '/' && isRealtorEntry ? '/people' : redirectTo;
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
    if (password.length < 6) { setError('Password needs to be at least 6 characters.'); return; }
    setStatus('loading');
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(entryDestination)}`,
        data: isRealtorEntry ? { account_entry_intent: 'realtor' } : undefined,
      },
    });
    if (signUpError) {
      setStatus(null);
      const msg = signUpError.message || '';
      if (/already registered|already exists|already in use/i.test(msg)) {
        setError('An account with that email already exists — try signing in instead.');
      } else {
        setError(msg || 'Could not create your account. Please try again.');
      }
      return;
    }
    if (data.session) {
      // This project has email confirmation turned off, so signUp already returned a
      // live session — take the new user straight to their destination.
      router.push(entryDestination);
      router.refresh();
    } else {
      // Email confirmation is required — Supabase already sent the confirmation link,
      // which carries the same redirect destination via the callback route above.
      setStatus('check-email');
    }
  };

  if (status === 'check-email') {
    return (
      <AuthShell headline={SIGN_UP_HEADLINE} description={SIGN_UP_DESCRIPTION}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Check your email</h2>
          <Banner kind="success">We sent a confirmation link to {email}. Click it to finish creating your account, then come back and sign in.</Banner>
          <Link href="/auth/sign-in" className="afh-btn afh-btn-ghost" style={{ textDecoration: 'none', textAlign: 'center' }}>Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell headline={SIGN_UP_HEADLINE} description={SIGN_UP_DESCRIPTION}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link
          href={redirectTo !== '/' ? `/auth/sign-in?redirect=${encodeURIComponent(redirectTo)}` : '/auth/sign-in'}
          className="afh-back-link"
          style={{ textDecoration: 'none' }}
        >
          <ArrowLeft size={13} /> Back to sign in
        </Link>

        <div>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>{isRealtorEntry ? 'Create your Realtor account' : 'Start your home search'}</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '5px 0 0', lineHeight: 1.55 }}>{isRealtorEntry ? 'Create an account with the email your client will invite. Realtor access is connected to each client relationship—not a global account role.' : 'Create your account to start comparing homes.'}</p>
        </div>

        <div>
          <label className="afh-label" htmlFor="sign-up-email">Email</label>
          <input className="afh-input" id="sign-up-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <PasswordField id="sign-up-password" label="Password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" />
        <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '-10px 0 0' }}>At least 6 characters.</p>
        <PasswordField id="sign-up-confirm" label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" autoComplete="new-password" />

        {error && (
          <Banner kind="error">
            {error}
            {/already exists/i.test(error) && <> <Link href="/auth/sign-in" style={{ color: 'inherit', fontWeight: 700 }}>Sign in →</Link></>}
          </Banner>
        )}

        <button type="submit" className="afh-btn" disabled={status === 'loading'}>
          {status === 'loading' ? <><Spinner /> Creating account...</> : isRealtorEntry ? 'Create account' : 'Start your home search'}
        </button>
      </form>
    </AuthShell>
  );
}

// Same fix as sign-in: useSearchParams() requires a Suspense boundary for any
// route eligible for static prerendering, and this page (no dynamic ancestor)
// is exactly that. Without this wrapper, `next build` fails outright.
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}
