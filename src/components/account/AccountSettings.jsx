'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, User, Lock, ChevronRight, AlertTriangle, RefreshCcw } from 'lucide-react';
import Sheet from '@/components/Sheet';
import { PasswordField, Banner, Spinner } from '@/components/auth/AuthHelpers';
import { createClient } from '@/lib/supabase/client';
import { updateProfileName } from '@/lib/supabase/data';
import SearchAccess from '@/components/account/SearchAccess';
import Connections from '@/components/account/Connections';

// Collapsed-by-default row (Profile, Password) matching the approved
// mockup's "summary line + chevron, expands in place" pattern.
function CollapsibleRow({ icon: Icon, title, summary, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hh-account-row ${open ? 'is-open' : ''}`}>
      <button type="button" className="hh-account-row-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hh-account-row-icon"><Icon size={17} /></span>
        <span className="hh-account-row-copy">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <ChevronRight size={18} className="hh-account-row-chevron" aria-hidden="true" />
      </button>
      {open && <div className="hh-account-row-body">{children}</div>}
    </div>
  );
}

// Email is auth-controlled (Supabase Auth, not the profiles table) and is
// shown read-only rather than wired to auth.updateUser({email}) here — that
// call requires its own confirmation-link flow and email-provider config
// that this settings pass doesn't own, and coupling it to the name save
// meant one failing silently masked the other. Name changes are a plain,
// independent write to profiles.first_name/last_name.
function ProfileForm({ userId, initialFirstName, initialLastName, initialEmail }) {
  const [firstName, setFirstName] = useState(initialFirstName || '');
  const [lastName, setLastName] = useState(initialLastName || '');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) { setError('Please enter your first and last name.'); return; }
    setStatus('saving'); setError('');
    try {
      const supabase = createClient();
      await updateProfileName(supabase, userId, firstName, lastName);
      setStatus('saved');
    } catch (nameError) {
      console.error('Account Settings: could not save profile name', nameError);
      setError("We couldn't save those changes. Please try again.");
      setStatus(null);
    }
  };

  return (
    <form onSubmit={save} className="hh-account-form">
      <div className="afh-name-row">
        <div><label className="afh-label" htmlFor="account-first-name">First name</label><input className="afh-input" id="account-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" /></div>
        <div><label className="afh-label" htmlFor="account-last-name">Last name</label><input className="afh-input" id="account-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" /></div>
      </div>
      <div><label className="afh-label" htmlFor="account-email">Email</label><input className="afh-input" id="account-email" type="email" value={initialEmail || ''} readOnly disabled autoComplete="email" /></div>
      {status === 'saved' && <Banner kind="success">Saved.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <button type="submit" className="hh-btn" disabled={status === 'saving'}>{status === 'saving' ? <><Spinner /> Saving…</> : 'Save changes'}</button>
    </form>
  );
}

function PasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    setError('');
    if (!password.trim() || !confirm.trim()) { setError('Please fill in both fields.'); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6) { setError('Password should be at least 6 characters.'); return; }
    setStatus('saving');
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || 'Could not update your password. Please try again.');
      setStatus(null);
      return;
    }
    setPassword(''); setConfirm(''); setStatus('done');
  };

  return (
    <form onSubmit={save} className="hh-account-form">
      <PasswordField id="account-new-password" label="New password" value={password} onChange={setPassword} placeholder="Create a new password" autoComplete="new-password" />
      <PasswordField id="account-confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="Re-enter your new password" autoComplete="new-password" />
      {status === 'done' && <Banner kind="success">Your password has been updated.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <button type="submit" className="hh-btn" disabled={status === 'saving'}>{status === 'saving' ? <><Spinner /> Updating…</> : 'Update password'}</button>
    </form>
  );
}

// Confirmation-only, by design: no account-deletion RPC exists yet, and
// building one here would mean deciding shared-search/co-buyer/Realtor/
// FLH+-entitlement deletion semantics as a side effect of a UI pass. This
// establishes the required explicit-confirmation step and is honest that
// nothing destructive can happen yet, rather than either wiring a real
// cascade or silently doing nothing on click.
function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [requested, setRequested] = useState(false);

  const close = () => { setOpen(false); setConfirmed(false); };

  return (
    <section className="hh-account-card hh-account-delete" aria-labelledby="delete-account-title">
      <span className="hh-account-eyebrow">Account</span>
      <h2 id="delete-account-title">Delete Account</h2>
      <p className="hh-account-card-intro">Permanently delete your Feels Like Home account and personal account data. You&apos;ll review what happens to any shared searches before deletion is completed.</p>
      <div className="hh-account-warning"><AlertTriangle size={16} /> This action cannot be undone.</div>
      <button type="button" className="hh-btn hh-account-delete-cta" onClick={() => setOpen(true)}>Delete my account</button>

      <Sheet open={open} onClose={close} size="compact" title="Delete your account?">
        {!requested ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px', lineHeight: 1.5 }}>
              This permanently removes your profile and personal account data. Searches you share with a co-buyer or Realtor are not deleted just because your account is — those relationships need to be resolved first.
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginBottom: 16 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
              I understand this cannot be undone.
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="hh-btn hh-btn-ghost" onClick={close}>Cancel</button>
              <button type="button" className="hh-btn" style={{ background: 'var(--brick)', borderColor: 'var(--brick)' }} disabled={!confirmed} onClick={() => setRequested(true)}>Delete my account</button>
            </div>
          </>
        ) : (
          <Banner kind="info">Account deletion isn&apos;t available yet. Nothing has been deleted — this will be enabled in an upcoming release.</Banner>
        )}
      </Sheet>
    </section>
  );
}

// hasFlhPlus is derived from real search_members data (relationships.length
// > 0), not a persisted entitlement flag — see SearchAccess for why. search
// is null for an account with no legitimate buyer search yet (Realtor-only,
// or mid-onboarding) — FLH+/Connections simply don't render for them.
export default function AccountSettings({ userId, userEmail, firstName, lastName, search, homeCount, initialRelationships, searchDataError = false }) {
  const [relationships, setRelationships] = useState(initialRelationships || []);
  const hasFlhPlus = relationships.length > 0;

  return (
    <main className="hh-account-page">
      <Link href="/search" className="hh-account-back"><ArrowLeft size={14} /> Back to My Search</Link>
      <header className="hh-account-header">
        <h1>Account Settings</h1>
        <p>Manage your profile, FLH+ access, and connections.</p>
      </header>

      <section className="hh-account-card hh-account-plain">
        <CollapsibleRow icon={User} title="Profile" summary="Update your name.">
          <ProfileForm userId={userId} initialFirstName={firstName} initialLastName={lastName} initialEmail={userEmail} />
        </CollapsibleRow>
        <CollapsibleRow icon={Lock} title="Password" summary="Change your password.">
          <PasswordForm />
        </CollapsibleRow>
      </section>

      {search && (
        searchDataError ? (
          // A real failure fetching search access/connections (never a
          // fabricated Free/no-relationships state) — Profile, Password, and
          // Delete Account above and below are unaffected by it.
          <section className="hh-account-card hh-account-data-error" role="alert">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <strong>Couldn&apos;t load your FLH+ access and connections</strong>
              <p>Your profile and password settings above still work. Try refreshing the page — if this keeps happening, let us know.</p>
            </div>
          </section>
        ) : (
          <>
            <SearchAccess hasFlhPlus={hasFlhPlus} homeCount={homeCount} />
            <Connections hasFlhPlus={hasFlhPlus} relationships={relationships} searchId={search.id} userId={userId} onRelationshipsChange={setRelationships} />
          </>
        )
      )}

      <DeleteAccountSection />
    </main>
  );
}
