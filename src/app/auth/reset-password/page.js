'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!password.trim() || !confirm.trim()) { setError('Please fill in both fields.'); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6) { setError('Password should be at least 6 characters.'); return; }
    setStatus('loading');
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setStatus(null);
      setError(updateError.message || 'Could not update your password. The reset link may have expired — request a new one.');
      return;
    }
    setStatus('done');
  };

  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 className="afh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Choose a new password</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '5px 0 0' }}>Enter a new password for your account.</p>
        </div>

        {status !== 'done' ? (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PasswordField label="New password" value={password} onChange={setPassword} placeholder="Create a new password" autoComplete="new-password" />
            <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="Re-enter your new password" autoComplete="new-password" />
            {error && <Banner kind="error">{error}</Banner>}
            <button type="submit" className="afh-btn" disabled={status === 'loading'}>
              {status === 'loading' ? <><Spinner /> Updating...</> : 'Update password'}
            </button>
          </form>
        ) : (
          <>
            <Banner kind="success">Your password has been updated.</Banner>
            <button type="button" className="afh-btn" onClick={() => router.push('/auth/sign-in')}>Continue to sign in</button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
