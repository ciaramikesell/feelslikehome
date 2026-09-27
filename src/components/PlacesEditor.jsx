'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, Check, MapPin, Pencil, Plus, UserPlus, X } from 'lucide-react';
import Sheet from '@/components/Sheet';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import { HelperRow, IconBadge, MobilePage, SectionCard, SectionLabel, StickyActionBar, SubpageHeader } from '@/components/MobileSystem';
import { placeDraftError, planPlaceChanges } from '@/lib/searchProfile';
import { createClient } from '@/lib/supabase/client';
import { createCommuteDestination, deleteCommuteDestination, updateCommuteDestination } from '@/lib/supabase/collaboration';

const BLANK = { label: '', address: '', maxDriveMinutes: '' };
// The threshold bar is a visual scale only (an hour reads as "full"); it never
// represents a calculated commute time, which this screen does not invent.
const BAR_SCALE_MINUTES = 60;

function PlaceForm({ initial, onSave, onCancel, isNew }) {
  const [draft, setDraft] = useState({ ...BLANK, ...initial, maxDriveMinutes: initial?.maxDriveMinutes ?? '' });
  const [touched, setTouched] = useState(false);
  const error = placeDraftError(draft);
  const submit = () => { setTouched(true); if (!error) onSave(draft); };
  return (
    <div className="flh-place-form">
      <label className="flh-field">
        <span className="flh-field-label">Name</span>
        <input className="flh-input" maxLength={80} placeholder="e.g. Work, Mom’s, School" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
      </label>
      <label className="flh-field">
        <span className="flh-field-label">Address</span>
        <input className="flh-input" maxLength={500} placeholder="123 Main St, Detroit, MI" autoComplete="street-address" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
      </label>
      <label className="flh-field">
        <span className="flh-field-label">Longest comfortable drive <em>(optional)</em></span>
        <span className="flh-number-input flh-number-input-short">
          <input inputMode="numeric" placeholder="30" value={draft.maxDriveMinutes} onChange={(event) => setDraft({ ...draft, maxDriveMinutes: event.target.value.replace(/[^0-9]/g, '') })} />
          <span aria-hidden="true">minutes</span>
        </span>
      </label>
      {touched && error && <p className="flh-field-error" role="alert">{error}</p>}
      <div className="flh-inline-actions">
        <button type="button" className="flh-text-action" onClick={onCancel}>Cancel</button>
        <button type="button" className="flh-button flh-button-primary flh-button-small" onClick={submit}>{isNew ? 'Add place' : 'Done'}</button>
      </div>
    </div>
  );
}

function PlaceCard({ place, onEdit, onRemove }) {
  const minutes = place.maxDriveMinutes === '' || place.maxDriveMinutes == null ? null : Number(place.maxDriveMinutes);
  return (
    <SectionCard className="flh-place-card">
      <div className="flh-card-row">
        <IconBadge icon={MapPin} />
        <div className="flh-card-heading">
          <h3 className="flh-card-title">{place.label}</h3>
          <p className="flh-card-sub flh-place-address">{place.address}</p>
        </div>
        <button type="button" className="flh-icon-button flh-icon-button-plain" aria-label={`Edit ${place.label}`} onClick={onEdit}><Pencil size={17} aria-hidden="true" /></button>
        <button type="button" className="flh-icon-button flh-icon-button-plain" aria-label={`Remove ${place.label}`} onClick={onRemove}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="flh-place-threshold">
        <span className="flh-place-mode"><Car size={15} aria-hidden="true" /> Drive</span>
        {minutes ? (
          <>
            <span className="flh-threshold-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (minutes / BAR_SCALE_MINUTES) * 100)}%` }} /></span>
            <strong>{minutes} min max</strong>
          </>
        ) : <span className="flh-threshold-none">No limit set</span>}
      </div>
    </SectionCard>
  );
}

// Focused editor for the participant's own places. Edits stay in a draft until
// "Save places" applies them through the existing per-row functions (RLS keeps
// every row the participant's own). Order is the stored created_at order; new
// places append. Commute times are never shown or invented here, and a place is
// only removed when the person removes it.
export default function PlacesEditor({ searchId, userId, initialDestinations = [], canInvite = false }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialDestinations);
  const [draft, setDraft] = useState(() => initialDestinations.map((place) => ({ ...place, key: place.id })));
  const [editing, setEditing] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const leave = () => router.push('/search');

  const upsertDraft = (values) => {
    setDraft((current) => (editing?.key
      ? current.map((place) => (place.key === editing.key ? { ...place, ...values } : place))
      : [...current, { ...values, id: null, key: `new-${Date.now()}-${current.length}` }]));
    setEditing(null);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const supabase = createClient();
    const { creates, updates, deletes } = planPlaceChanges(saved, draft);
    let baseline = saved;
    let working = draft;
    try {
      for (const id of deletes) {
        await deleteCommuteDestination(supabase, id);
        baseline = baseline.filter((place) => place.id !== id);
      }
      for (const { id, changes } of updates) {
        const row = await updateCommuteDestination(supabase, id, changes);
        baseline = baseline.map((place) => (place.id === id ? row : place));
      }
      for (const { key, values } of creates) {
        const row = await createCommuteDestination(supabase, searchId, userId, values);
        baseline = [...baseline, row];
        working = working.map((entry) => (entry.key === key ? { ...row, key: row.id } : entry));
      }
      router.push('/search');
      router.refresh();
    } catch (saveError) {
      console.error('Could not save places', saveError);
      // Whatever already succeeded is now the saved baseline, so retrying never
      // repeats a finished create/delete.
      setSaved(baseline);
      setDraft(working);
      setError('We couldn’t save every change. Your edits are still here—please try again.');
      setSaving(false);
    }
  };

  return (
    <MobilePage width="narrow" className="flh-has-action-bar">
      <SubpageHeader title="Places that matter" onBack={leave} onCancel={leave} />
      <HelperRow tone="sage" icon={MapPin} title="Keep everyday life within reach" body="Set the longest commute you’re comfortable with. These places are private to you." />
      {error && <p className="hh-save-error" role="alert">{error}</p>}
      <SectionLabel as="h2" meta={`${draft.length} saved`}>Your places</SectionLabel>
      {draft.length ? (
        <div className="flh-place-list">
          {draft.map((place) => (
            <PlaceCard key={place.key} place={place} onEdit={() => setEditing(place)} onRemove={() => setDraft((current) => current.filter((entry) => entry.key !== place.key))} />
          ))}
        </div>
      ) : (
        <p className="flh-card-empty">No places yet. Add work, family, school—anywhere you go often—and we’ll compare the trip from every home.</p>
      )}
      <button type="button" className="flh-button flh-button-outline flh-button-block" onClick={() => setEditing({})}><Plus size={16} aria-hidden="true" /> {draft.length ? 'Add another place' : 'Add a place'}</button>
      {canInvite && (
        <SectionCard tone="warm" className="flh-invite-card">
          <div className="flh-card-row">
            <IconBadge icon={UserPlus} />
            <div className="flh-card-heading">
              <h3 className="flh-card-title">Searching together?</h3>
              <p className="flh-card-sub">Invite someone to add the places that matter to them.</p>
            </div>
            <button type="button" className="flh-button flh-button-primary flh-button-small" onClick={() => setInviteOpen(true)}>Invite</button>
          </div>
        </SectionCard>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.key ? 'Edit place' : 'Add a place'} size="compact">
        {editing !== null && <PlaceForm initial={editing} isNew={!editing.key} onSave={upsertDraft} onCancel={() => setEditing(null)} />}
      </Sheet>
      {inviteOpen && <InviteCoBuyer searchId={searchId} userId={userId} embedded onClose={() => setInviteOpen(false)} />}
      <StickyActionBar note={`${draft.length} ${draft.length === 1 ? 'place' : 'places'} · commute limits help compare homes`}>
        <button type="button" className="flh-button flh-button-primary flh-button-block" disabled={saving} onClick={save}><Check size={18} aria-hidden="true" /> {saving ? 'Saving…' : 'Save places'}</button>
      </StickyActionBar>
    </MobilePage>
  );
}
