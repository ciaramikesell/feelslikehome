'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';

export default function AuthForm({ initialMode = 'sign-in', redirectTo = '/', isRealtorEntry = false, inline = false, onModeChange }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const entryDestination = redirectTo === '/' && isRealtorEntry ? '/realtor' : redirectTo;

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setStatus(null);
    onModeChange?.(nextMode);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (mode === 'sign-up' && (!firstName.trim() || !lastName.trim())) {
      setError('Please enter your first and last name.');
      return;
    }
    if (!email.trim() || !password.trim() || (mode === 'sign-up' && !confirm.trim())) {
      setError(mode === 'sign-in' ? 'Please enter both your email and password.' : 'Please fill in every field.');
      return;
    }
    if (mode === 'sign-up' && password !== confirm) { setError("Passwords don't match."); return; }
    if (mode === 'sign-up' && password.length < 6) { setError('Password needs to be at least 6 characters.'); return; }
    setStatus('loading');
    const supabase = createClient();

    if (mode === 'sign-in') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setStatus(null);
        setError(signInError.message || 'Invalid login credentials.');
        return;
      }
      router.push(redirectTo);
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(entryDestination)}`,
        // Entry context is deliberately non-authorizing. Access remains relationship-scoped by RLS.
        // first_name/last_name seed profiles.first_name/last_name via handle_new_user — the
        // canonical name record — not a second, unsynchronized source of truth.
        data: { first_name: firstName.trim(), last_name: lastName.trim(), ...(isRealtorEntry ? { account_entry_intent: 'realtor' } : {}) },
      },
    });
    if (signUpError) {
      setStatus(null);
      const message = signUpError.message || '';
      setError(/already registered|already exists|already in use/i.test(message)
        ? 'An account with that email already exists — try signing in instead.'
        : message || 'Could not create your account. Please try again.');
      return;
    }
    if (data.session) {
      router.push(entryDestination);
      router.refresh();
    } else {
      setStatus('check-email');
    }
  };

  if (status === 'check-email') {
    return <div className="afh-form-stack"><h2 className="afh-serif">Check your email</h2><Banner kind="success">We sent a confirmation link to {email}. Click it to finish creating your account, then come back and sign in.</Banner><button type="button" className="afh-btn afh-btn-ghost" onClick={() => switchMode('sign-in')}>Back to sign in</button></div>;
  }

  const signIn = mode === 'sign-in';
  return (
    <form onSubmit={submit} className="afh-form-stack" aria-label={signIn ? 'Sign in' : 'Create account'}>
      <div>
        <h2 className="afh-serif">{signIn ? (inline && !isRealtorEntry ? 'Welcome back.' : 'Sign in') : isRealtorEntry ? 'Create your Realtor account' : 'Start your home search'}</h2>
        <p className="afh-form-intro">{signIn ? (inline && isRealtorEntry ? 'Welcome back.' : 'Pick up where you left off.') : isRealtorEntry && inline ? 'Help buyers organize what matters, understand their options, and make clearer decisions together.' : isRealtorEntry ? 'Set up a client search or join a buyer who invited you. Access to every search is connected to that client relationship—not a global account role.' : 'Create your account to start comparing homes.'}</p>
      </div>
      {!signIn && <div className="afh-name-row">
        <div><label className="afh-label" htmlFor={`${inline ? 'popover-' : ''}${mode}-first-name`}>First name</label><input autoFocus={inline} className="afh-input" id={`${inline ? 'popover-' : ''}${mode}-first-name`} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First" autoComplete="given-name" /></div>
        <div><label className="afh-label" htmlFor={`${inline ? 'popover-' : ''}${mode}-last-name`}>Last name</label><input className="afh-input" id={`${inline ? 'popover-' : ''}${mode}-last-name`} type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last" autoComplete="family-name" /></div>
      </div>}
      <div><label className="afh-label" htmlFor={`${inline ? 'popover-' : ''}${mode}-email`}>Email</label><input autoFocus={inline && signIn} className="afh-input" id={`${inline ? 'popover-' : ''}${mode}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>
      <PasswordField id={`${inline ? 'popover-' : ''}${mode}-password`} label="Password" value={password} onChange={setPassword} placeholder={signIn ? '••••••••' : 'Create a password'} autoComplete={signIn ? 'current-password' : 'new-password'} />
      {signIn ? <div className="afh-forgot"><Link href="/auth/forgot-password" className="afh-link">Forgot password?</Link></div> : <><p className="afh-password-hint">At least 6 characters.</p><PasswordField id={`${inline ? 'popover-' : ''}sign-up-confirm`} label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" autoComplete="new-password" /></>}
      {error && <div aria-live="polite"><Banner kind="error">{error}</Banner></div>}
      <button type="submit" className="afh-btn" disabled={status === 'loading'}>{status === 'loading' ? <><Spinner /> {signIn ? 'Signing in...' : 'Creating account...'}</> : signIn ? 'Sign in' : isRealtorEntry ? 'Create Realtor account' : 'Start your home search'}</button>
      {signIn && <div className="afh-divider"><span>or</span></div>}
      {signIn && <p className="afh-new-account">New to Feels Like Home?</p>}
      <button type="button" className="afh-btn afh-btn-ghost" onClick={() => switchMode(signIn ? 'sign-up' : 'sign-in')}>{signIn ? (isRealtorEntry ? 'Create a Realtor account' : 'Create an account') : isRealtorEntry ? 'Sign in' : 'Back to sign in'}</button>
    </form>
  );
}
