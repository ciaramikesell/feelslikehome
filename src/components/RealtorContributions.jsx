'use client';

import { useState } from 'react';
import { Footprints, MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteRealtorNote, saveRealtorNote, suggestHomeTour } from '@/lib/supabase/collaboration';

export default function RealtorContributions({ searchId, homeId, contributions, viewerId, realtorView = false, archived = false }) {
  const router = useRouter();
  const mine = contributions.notes.find((note) => note.author_id === viewerId);
  const [content, setContent] = useState(mine?.content || '');
  const [editing, setEditing] = useState(!mine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alreadySuggested = contributions.tours.some((tour) => tour.suggested_by === viewerId);
  const run = async (operation) => {
    setBusy(true); setError('');
    try { await operation(createClient()); router.refresh(); } catch { setError("We couldn't save that. Please try again."); } finally { setBusy(false); }
  };
  return <section className="hh-realtor-contributions" aria-label="Realtor contributions">
    <div className="hh-contribution-heading"><MessageSquare size={18} /><div><span>Professional context</span><h2>From the Realtor</h2></div></div>
    {contributions.notes.map((note) => <article className="hh-realtor-note" key={note.id}>
      <strong>From {note.author_display_name}</strong><p>{note.content}</p>
      {note.updated_at !== note.created_at && <small>Edited</small>}
      {realtorView && note.author_id === viewerId && !editing && <div><button className="hh-text-button" onClick={() => setEditing(true)}>Edit my note</button><button className="hh-text-button danger" disabled={busy} onClick={() => run((db) => deleteRealtorNote(db, note.id))}>Delete</button></div>}
    </article>)}
    {realtorView && editing && <div className="hh-note-composer"><label htmlFor="realtor-note">Your note</label><textarea id="realtor-note" className="hh-textarea" maxLength={2000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Share professional context that may help this decision." /><div><button className="hh-btn" disabled={busy || !content.trim()} onClick={() => run(async (db) => { await saveRealtorNote(db, searchId, homeId, content); setEditing(false); })}>{busy ? 'Saving…' : 'Save note'}</button>{mine && <button className="hh-btn hh-btn-ghost" onClick={() => { setContent(mine.content); setEditing(false); }}>Cancel</button>}</div></div>}
    {!realtorView && contributions.notes.length === 0 && contributions.tours.length === 0 && <p className="hh-muted">No Realtor context has been added yet.</p>}
    {!archived && contributions.tours.map((tour) => <div className="hh-tour-suggestion" key={tour.id}><Footprints size={18} /><strong>{tour.suggested_by_display_name} thinks this one is worth touring.</strong>{!realtorView && <span>Your Want to Tour choice stays yours.</span>}</div>)}
    {realtorView && !archived && <button className="hh-btn hh-btn-ghost" disabled={busy || alreadySuggested} onClick={() => run((db) => suggestHomeTour(db, searchId, homeId))}><Footprints size={16} />{alreadySuggested ? 'Tour suggested' : 'Suggest a tour'}</button>}
    {archived && realtorView && <p className="hh-muted">This home is archived. Notes remain available, but tour suggestions are paused.</p>}
    {error && <p className="hh-error-text" role="alert">{error}</p>}
  </section>;
}
