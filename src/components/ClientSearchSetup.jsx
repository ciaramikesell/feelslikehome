'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { defaultPriorities, normalizePriorities } from '@/lib/constants';
import { NEW_SEARCH_CHOICES, ONBOARDING_SUGGESTIONS, applySearchChoice, applyOnboardingSelections } from '@/lib/onboarding';
import { createClient } from '@/lib/supabase/client';
import { claimProspectiveSearch, createProspectiveSearch, inviteProspectiveClient } from '@/lib/supabase/collaboration';

const keyFor = (item) => `${item.categoryKey}:${item.label}`;
const selectedFrom = (priorities) => new Set(Object.entries(priorities).flatMap(([category, value]) =>
  Object.entries(value?.tiers || {}).filter(([, tier]) => tier === 'must' || tier === 'important').map(([label]) => `${category}:${label}`)));
const mustFrom = (priorities) => new Set(Object.entries(priorities).flatMap(([category, value]) =>
  Object.entries(value?.tiers || {}).filter(([, tier]) => tier === 'must').map(([label]) => `${category}:${label}`)));

function NumericField({ label, value, onChange, prefix, suffix, placeholder }) {
  return <label className="hh-onboarding-field"><span className="hh-label">{label}</span><span className="hh-onboarding-input-wrap">{prefix}<input className="hh-input" inputMode="numeric" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />{suffix}</span></label>;
}

export default function ClientSearchSetup({ mode = 'realtor', token = null, inviterName = '', initialDraft = null }) {
  const router = useRouter();
  const initial = normalizePriorities(initialDraft?.draft_priorities || initialDraft?.draftPriorities || defaultPriorities());
  const [priorities, setPriorities] = useState(initial);
  const [selected, setSelected] = useState(() => selectedFrom(initial));
  const [dealbreakers, setDealbreakers] = useState(() => mustFrom(initial));
  const [step, setStep] = useState(1);
  const [clientName, setClientName] = useState(initialDraft?.client_name || '');
  const [email, setEmail] = useState(initialDraft?.invited_email || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = ONBOARDING_SUGGESTIONS[priorities.onboardingSearchType] || [];
  const selectedItems = useMemo(() => choices.flatMap(([, items]) => items).filter((item) => selected.has(keyFor(item))), [choices, selected]);
  const patchValue = (field, value) => setPriorities((current) => ({ ...current, [field]: { ...current[field], value } }));
  const chooseType = (choice) => setPriorities((current) => applySearchChoice(current, choice));
  const toggleSelected = (item) => { const key = keyFor(item); setSelected((current) => { const next = new Set(current); if (next.has(key)) { next.delete(key); setDealbreakers((must) => { const copy = new Set(must); copy.delete(key); return copy; }); } else next.add(key); return next; }); };
  const finalPriorities = () => applyOnboardingSelections(priorities, selected, dealbreakers);
  const finish = async () => {
    setBusy(true); setError('');
    try {
      const supabase = createClient();
      if (mode === 'buyer') {
        const result = await claimProspectiveSearch(supabase, token, finalPriorities());
        if (!result.success) throw new Error(result.reason || 'claim_failed');
        router.push('/search?welcome=1'); router.refresh(); return;
      }
      let draft = initialDraft;
      if (draft?.id) {
        const result = await supabase.from('prospective_searches').update({ client_name: clientName.trim() || null, draft_priorities: finalPriorities() }).eq('id', draft.id).in('status', ['draft', 'invited']).select('id').single();
        if (result.error) throw result.error;
      } else draft = await createProspectiveSearch(supabase, finalPriorities(), clientName);
      if (email.trim()) await inviteProspectiveClient(supabase, draft.id, email);
      router.push('/people'); router.refresh();
    } catch (caught) { setError(mode === 'buyer' ? "We couldn't claim this search. Check that you're signed in with the invited email and try again." : "We couldn't save this search. Please try again."); setBusy(false); }
  };
  return <div className="hh-root"><div className="hh-onboarding-shell"><div className={`hh-corner hh-onboarding-card ${step > 1 ? 'is-wide' : ''}`}>
    <div className="hh-onboarding-brand"><BrandMark size={30} /><span className="hh-serif"><span>Feels Like </span><b>Home</b></span></div>
    <ol className="hh-onboarding-progress" aria-label="Search setup progress">{['The basics', 'What matters', 'Dealbreakers', mode === 'buyer' ? 'Confirm' : 'Invite'].map((label, index) => <li key={label} className={step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''}><span>{step > index + 1 ? <Check size={12} /> : index + 1}</span><b>{label}</b></li>)}</ol>
    {error && <p className="hh-save-error" role="alert">{error}</p>}
    {step === 1 && <section className="hh-onboarding-step"><header><h1 className="hh-serif">{mode === 'buyer' ? `${inviterName} got your search started.` : "Start a client's search."}</h1><p>{mode === 'buyer' ? "Here's what they heard you're looking for. Change or remove anything before we start matching homes for you." : "Add as much or as little as you know. This stays a draft until the buyer reviews it and makes it their own."}</p></header>
      {mode === 'realtor' && <label className="hh-onboarding-field"><span className="hh-label">Client name (optional)</span><input className="hh-input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Jamie R." /></label>}
      <fieldset className="hh-onboarding-fieldset"><legend className="hh-label">What are they searching for?</legend><div className="hh-choice-grid">{NEW_SEARCH_CHOICES.map((choice) => <button type="button" key={choice.key} className={`hh-choice-card ${priorities.onboardingSearchType === choice.key ? 'on' : ''}`} onClick={() => chooseType(choice.key)}>{priorities.onboardingSearchType === choice.key && <Check size={15} />}{choice.label}</button>)}</div></fieldset>
      <div className="hh-onboarding-basics-grid"><NumericField label="Maximum budget" prefix="$" placeholder="450,000" value={priorities.budget.value} onChange={(v) => patchValue('budget', v)} /><NumericField label="Minimum bedrooms" suffix="beds" placeholder="3" value={priorities.bedsMin.value} onChange={(v) => patchValue('bedsMin', v)} /><NumericField label="Minimum bathrooms" suffix="baths" placeholder="2" value={priorities.bathsMin.value} onChange={(v) => patchValue('bathsMin', v)} /><NumericField label="Minimum square footage" suffix="sq ft" placeholder="1,800" value={priorities.sqftTarget.value} onChange={(v) => patchValue('sqftTarget', v)} /></div>
      <nav className="hh-onboarding-actions"><span /><button className="hh-btn" onClick={() => setStep(2)}>Continue</button></nav></section>}
    {step === 2 && <section className="hh-onboarding-step"><header><h1 className="hh-serif">{mode === 'buyer' ? `${inviterName} said these things matter to you.` : 'What seems to matter to them?'}</h1><p>{mode === 'buyer' ? 'Keep these, remove them, or add anything they missed. These become yours only after you confirm.' : 'Choose from the same criteria buyers use. These are your understanding—not the buyer’s confirmed opinions.'}</p></header>
      {choices.length ? <div className="hh-onboarding-suggestions">{choices.map(([title, items]) => <section key={title}><h2>{title}</h2><div>{items.map((item) => <button type="button" className={`hh-chip ${selected.has(keyFor(item)) ? 'on' : ''}`} key={keyFor(item)} onClick={() => toggleSelected(item)}>{selected.has(keyFor(item)) && <Check size={13} />}{item.displayLabel}</button>)}</div></section>)}</div> : <p className="hh-onboarding-empty">Choose a search type to see suggestions, or continue with no draft criteria.</p>}
      <nav className="hh-onboarding-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setStep(1)}>Back</button><button className="hh-btn" onClick={() => setStep(3)}>Continue</button></nav></section>}
    {step === 3 && <section className="hh-onboarding-step"><header><h1 className="hh-serif">{mode === 'buyer' ? 'Which are truly dealbreakers?' : 'Possible dealbreakers'}</h1><p>{mode === 'buyer' ? 'You decide. Selected items become Must Have; everything else stays Important.' : 'Mark what you understand may be hard to compromise on. The buyer will make the final call.'}</p></header>
      {selectedItems.length ? <div className="hh-dealbreaker-chips">{selectedItems.map((item) => <button type="button" className={`hh-chip ${dealbreakers.has(keyFor(item)) ? 'on' : ''}`} key={keyFor(item)} onClick={() => setDealbreakers((current) => { const next = new Set(current); next.has(keyFor(item)) ? next.delete(keyFor(item)) : next.add(keyFor(item)); return next; })}>{dealbreakers.has(keyFor(item)) && <Check size={13} />}{item.displayLabel}</button>)}</div> : <p className="hh-onboarding-empty">No priorities selected. That&apos;s okay.</p>}
      <nav className="hh-onboarding-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setStep(2)}>Back</button><button className="hh-btn" onClick={() => setStep(4)}>Continue</button></nav></section>}
    {step === 4 && <section className="hh-onboarding-step"><header><h1 className="hh-serif">{mode === 'buyer' ? 'Make this search yours.' : 'Invite client to join'}</h1><p>{mode === 'buyer' ? 'Confirming creates your own perspective and keeps your Realtor connected. You can change these preferences later.' : "Send a secure invitation now, or leave the email blank and return later. An invitation does not create membership or buyer-owned state."}</p></header>
      {mode === 'realtor' && <label className="hh-onboarding-field"><span className="hh-label">Client email (optional)</span><input className="hh-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" /></label>}
      <nav className="hh-onboarding-actions"><button className="hh-btn hh-btn-ghost" onClick={() => setStep(3)}>Back</button><button className="hh-btn" disabled={busy} onClick={finish}>{busy ? 'Saving…' : mode === 'buyer' ? 'Confirm and start matching' : email.trim() ? 'Save and create invitation' : 'Save draft'}</button></nav></section>}
  </div></div></div>;
}
