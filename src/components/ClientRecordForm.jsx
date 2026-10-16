'use client';

import { useMemo, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createClientRecord, openConnectedClientRecord, updateClientRecord } from '@/lib/supabase/collaboration';
import { NEW_SEARCH_CHOICES } from '@/lib/onboarding';
import { CLIENT_LIMITS, draftFromForm, formFromRecord, parseLocations, validateForm, wishlistChoices } from '@/lib/clientRecords';

const SHOWN_WISHES = 10;

function Field({ label, hint, error, children, className = '' }) {
  return <label className={`hh-client-field ${className}`}><span className="hh-label">{label}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="is-error" role="alert">{error}</small>}</label>;
}

// The Realtor's private record for one client. For a prospective client it
// also holds the proposed criteria (shared only through an invitation the
// buyer opens and confirms); for a connected client only the Realtor's own
// details and notes — their preferences are the buyer's and are never edited
// or copied here.
export default function ClientRecordForm({ record = null, connectedSearchId = null, onSaved, onCancel }) {
  const connected = Boolean(connectedSearchId) || record?.status === 'connected';
  const [form, setForm] = useState(() => formFromRecord(record));
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [allWishes, setAllWishes] = useState(false);
  const wishes = useMemo(() => wishlistChoices(form.searchChoice), [form.searchChoice]);
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const keyOf = (item) => `${item.categoryKey}:${item.label}`;
  const toggleWish = (item) => setForm((current) => {
    const key = keyOf(item);
    return { ...current, wishlist: current.wishlist.includes(key) ? current.wishlist.filter((k) => k !== key) : [...current.wishlist, key] };
  });
  const chooseType = (key) => setForm((current) => (current.searchChoice === key ? current : { ...current, searchChoice: key, wishlist: [], dealbreakers: [] }));
  const visibleWishes = allWishes ? wishes : wishes.slice(0, SHOWN_WISHES);

  const save = async (event) => {
    event.preventDefault();
    const found = validateForm(form, { connected });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setFailure('');
    try {
      const supabase = createClient();
      const details = { name: form.name, contactEmail: form.contactEmail, contactPhone: form.contactPhone, preferredLocations: parseLocations(form.locations), notes: form.notes };
      let id = record?.id;
      if (connected) {
        if (!id) id = await openConnectedClientRecord(supabase, connectedSearchId);
        await updateClientRecord(supabase, id, details);
      } else if (id) {
        await updateClientRecord(supabase, id, { ...details, draftPriorities: draftFromForm(form, record.draftPriorities) });
      } else {
        id = await createClientRecord(supabase, { ...details, draftPriorities: draftFromForm(form) });
      }
      onSaved?.(id);
    } catch {
      setFailure('We couldn’t save this client. Please try again.');
      setBusy(false);
    }
  };

  return <form className="hh-client-form" onSubmit={save} noValidate>
    <fieldset>
      <legend>{connected ? 'For your records' : 'About them'}</legend>
      <Field label={connected ? 'Name (optional)' : 'Name'} error={errors.name} className="is-wide">
        <input className="hh-input" value={form.name} onChange={set('name')} maxLength={CLIENT_LIMITS.name} placeholder={connected ? 'How you refer to them' : 'Jamie Rivera'} autoComplete="off" required={!connected} />
      </Field>
      <Field label="Email (optional)" error={errors.contactEmail}><input className="hh-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} maxLength={CLIENT_LIMITS.email} placeholder="jamie@example.com" autoComplete="off" /></Field>
      <Field label="Phone (optional)" error={errors.contactPhone}><input className="hh-input" type="tel" value={form.contactPhone} onChange={set('contactPhone')} maxLength={CLIENT_LIMITS.phone} placeholder="(555) 014-2200" autoComplete="off" /></Field>
      <Field label="Preferred locations (optional)" hint="Separate places with commas." className="is-wide"><input className="hh-input" value={form.locations} onChange={set('locations')} placeholder="Maplewood, South Orange" autoComplete="off" /></Field>
    </fieldset>

    {!connected && <fieldset>
      <legend>What they’re looking for</legend>
      <p className="hh-client-form-note">Your starting point. If you invite them, they’ll see these as suggestions to keep, change or remove — nothing becomes theirs until they confirm.</p>
      <div className="hh-client-choice" role="radiogroup" aria-label="Kind of search">{NEW_SEARCH_CHOICES.map((choice) => <button type="button" role="radio" aria-checked={form.searchChoice === choice.key} key={choice.key} className={`hh-chip ${form.searchChoice === choice.key ? 'on' : ''}`} onClick={() => chooseType(choice.key)}>{form.searchChoice === choice.key && <Check size={13} />}{choice.label}</button>)}</div>
      <div className="hh-client-form-numbers">
        <Field label={form.searchChoice === 'home_buy' ? 'Budget up to' : 'Rent up to'}><span className="hh-client-affix"><span aria-hidden="true">$</span><input className="hh-input" inputMode="numeric" value={form.budget} onChange={set('budget')} placeholder={form.searchChoice === 'home_buy' ? '600,000' : '2,800'} /></span></Field>
        <Field label="Bedrooms"><input className="hh-input" inputMode="numeric" value={form.beds} onChange={set('beds')} placeholder="3+" /></Field>
        <Field label="Bathrooms"><input className="hh-input" inputMode="decimal" value={form.baths} onChange={set('baths')} placeholder="2+" /></Field>
      </div>
      <div className="hh-client-wishes">
        <span className="hh-label">A few things on their wishlist</span>
        <div>{visibleWishes.map((item) => { const on = form.wishlist.includes(keyOf(item)); return <button type="button" aria-pressed={on} key={keyOf(item)} className={`hh-chip ${on ? 'on' : ''}`} onClick={() => toggleWish(item)}>{on && <Check size={13} />}{item.displayLabel}</button>; })}</div>
        {wishes.length > SHOWN_WISHES && <button type="button" className="hh-client-more" onClick={() => setAllWishes((value) => !value)}>{allWishes ? 'Show fewer' : `Show all ${wishes.length}`}</button>}
      </div>
    </fieldset>}

    <fieldset>
      <legend>Your notes</legend>
      <Field label="Notes (optional)" error={errors.notes} className="is-wide">
        <textarea className="hh-input" rows={5} value={form.notes} onChange={set('notes')} maxLength={CLIENT_LIMITS.notes} placeholder="Timeline, financing, what they lit up about on the last tour…" />
      </Field>
      <p className="hh-client-private"><Lock size={13} aria-hidden="true" /> Only you can see your notes, contact details and locations. {connected ? 'They never change your client’s search.' : 'They’re never shared, even if you invite them.'}</p>
    </fieldset>

    {failure && <p className="flh-people-error" role="alert">{failure}</p>}
    <div className="flh-sheet-actions hh-client-form-actions">
      <button type="button" className="flh-button flh-button-outline" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className="flh-button flh-button-primary" disabled={busy}>{busy ? 'Saving…' : record || connected ? 'Save' : 'Add client'}</button>
    </div>
  </form>;
}
