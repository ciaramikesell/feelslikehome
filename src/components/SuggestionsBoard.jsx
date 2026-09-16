'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Minus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { dismissSuggestion, promoteSuggestion } from '@/lib/supabase/collaboration';
import { computeMatch } from '@/lib/matching';
import { homeIdentity } from '@/lib/homePresentation';
import { formatHomePrice } from '@/lib/homeDisplay';

const REASONS = ['Price', 'Location', 'Layout', 'Condition', 'Missing a must-have', "Just don't like it", 'Other'];

function SuggestionCard({ suggestion, userId, priorities, past }) {
  const router = useRouter();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const home = suggestion.home;
  const identity = homeIdentity(home, priorities);
  const match = computeMatch(home, priorities);
  const mine = suggestion.dispositions.find((row) => row.userId === userId);
  const others = suggestion.dispositions.filter((row) => row.userId !== userId);

  const dismiss = async () => {
    setBusy(true); setError('');
    try { await dismissSuggestion(createClient(), suggestion.id); setFeedbackOpen(true); router.refresh(); }
    catch { setError("Couldn't dismiss this suggestion. Try again."); }
    finally { setBusy(false); }
  };
  const saveFeedback = async () => {
    setBusy(true); setError('');
    try { await dismissSuggestion(createClient(), suggestion.id, reasons, other); setFeedbackOpen(false); router.refresh(); }
    catch { setError("Couldn't save that feedback. Try again."); }
    finally { setBusy(false); }
  };
  const accept = async () => {
    setBusy(true); setError('');
    try { const homeId = await promoteSuggestion(createClient(), suggestion.id); router.push(`/homes/${homeId}`); router.refresh(); }
    catch { setError("Couldn't add this home. Try again."); setBusy(false); }
  };

  return <article className={`hh-suggestion-card${past ? ' is-past' : ''}`}>
    <div className="hh-suggestion-photo">{home.photoUrl ? <img src={home.photoUrl} alt="" /> : <span>Home</span>}</div>
    <div className="hh-suggestion-body"><div><span className="hh-provenance">Suggested by {suggestion.suggestedByName}</span><h3>{identity.primary}</h3>{identity.supporting && <p>{identity.supporting}</p>}</div>
      <strong className="hh-suggestion-price">{formatHomePrice(home.price, priorities.searchType) || 'Price unknown'}</strong>
      <p className="hh-suggestion-facts">{[home.beds && `${home.beds} bd`,home.baths && `${home.baths} ba`,home.sqft && `${home.sqft} sq ft`].filter(Boolean).join(' · ') || 'Property details are still limited.'}</p>
      {match && <div className="hh-suggestion-match"><b>{match.pct == null ? 'Match needs more known facts' : `${match.pct}% Match for you`}</b>{match.allSelected.slice(0,5).map((item) => <span key={item.key} className={!item.evaluated ? 'unknown' : item.met ? 'met' : 'missed'}>{!item.evaluated ? <Minus size={12}/> : item.met ? <Check size={12}/> : <X size={12}/>} {item.label} — {!item.evaluated ? 'Unknown' : item.met ? 'Matches' : 'Does not match'}</span>)}</div>}
      {others.length > 0 && <p className="hh-cobuyer-dismissed">Dismissed by your co-buyer</p>}
      {past ? <strong className="hh-suggestion-outcome">{suggestion.status === 'accepted' ? 'Added to My Homes' : mine ? 'You dismissed this suggestion' : 'Dismissed'}</strong> : <div className="hh-suggestion-actions"><button className="hh-btn" disabled={busy} onClick={accept}>Add to My Homes</button><button className="hh-btn hh-btn-ghost" disabled={busy} onClick={dismiss}>Dismiss</button></div>}
      {feedbackOpen && <div className="hh-dismiss-feedback"><strong>Want to tell {suggestion.suggestedByName} why?</strong><small>Optional — your dismissal is already saved.</small><div>{REASONS.map((reason) => <label key={reason}><input type="checkbox" checked={reasons.includes(reason)} onChange={() => setReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current,reason])}/>{reason}</label>)}</div>{reasons.includes('Other') && <textarea maxLength={280} value={other} onChange={(event) => setOther(event.target.value)} placeholder="Optional note"/>}<button className="hh-btn hh-btn-ghost" onClick={saveFeedback} disabled={busy}>Save feedback</button></div>}
      {error && <p role="alert" className="hh-error-text">{error}</p>}
    </div>
  </article>;
}

export default function SuggestionsBoard({ suggestions, userId, priorities }) {
  const pending = suggestions.filter((item) => item.status === 'pending' && !item.dispositions.some((row) => row.userId === userId));
  const past = suggestions.filter((item) => item.status !== 'pending' || item.dispositions.some((row) => row.userId === userId));
  return <main className="hh-suggestions-page"><header><a href="/homes">← Homes</a><span>Realtor suggestions</span><h1>Homes worth a look</h1><p>A suggestion stays outside My Homes until you decide to add it.</p></header>
    <section><h2>New / Pending Suggestions</h2>{pending.length ? <div className="hh-suggestion-list">{pending.map((item) => <SuggestionCard key={item.id} suggestion={item} userId={userId} priorities={priorities}/>)}</div> : <div className="hh-realtor-empty">No pending suggestions.</div>}</section>
    <section className="hh-past-suggestions"><h2>Past Suggestions</h2>{past.length ? <div className="hh-suggestion-list">{past.map((item) => <SuggestionCard key={item.id} suggestion={item} userId={userId} priorities={priorities} past/>)}</div> : <p className="hh-muted">No past suggestions yet.</p>}</section>
  </main>;
}
