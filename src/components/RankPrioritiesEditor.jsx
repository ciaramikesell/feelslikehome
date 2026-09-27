'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Check, Plus, ShieldCheck } from 'lucide-react';
import Sheet from '@/components/Sheet';
import RankBoard from '@/components/RankBoard';
import { ChoiceChip, HelperRow, MobilePage, StickyActionBar, SubpageHeader } from '@/components/MobileSystem';
import { normalizePriorities } from '@/lib/constants';
import {
  addCriterion, addCustomCriterion, availableCriteriaGroups, customCategoryOptions, moveCriterion,
  offeredCriteriaGroups, priorityLevels, selectedPriorityCount, setGaragePreference,
} from '@/lib/searchProfile';
import { createClient } from '@/lib/supabase/client';
import { savePriorities } from '@/lib/supabase/collaboration';

function AddPrioritySheet({ open, onClose, draft, setDraft }) {
  const groups = availableCriteriaGroups(draft);
  const offered = offeredCriteriaGroups(draft).flatMap((group) => group.items);
  const categories = customCategoryOptions(draft);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(categories[0]?.key || 'location');
  const addTyped = () => {
    if (!label.trim()) return;
    setDraft((current) => addCustomCriterion(current, category, label, offered));
    setLabel('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add a priority" size="large">
      <p className="flh-sheet-lead">New priorities start as Important. You can move them once they’re on your board.</p>
      {groups.map((group) => (
        <section key={group.title} className="flh-add-group">
          <h3 className="flh-section-kicker">{group.title}</h3>
          <div className="flh-chip-row">
            {group.items.map((criterion) => <ChoiceChip key={criterion.key} selected={false} onClick={() => setDraft((current) => addCriterion(current, criterion))}>{criterion.displayLabel}</ChoiceChip>)}
          </div>
        </section>
      ))}
      {!groups.length && <p className="flh-card-empty">Everything we suggest is already on your board.</p>}
      <section className="flh-add-group">
        <h3 className="flh-section-kicker">Add your own</h3>
        <div className="flh-custom-row">
          <input className="flh-input" aria-label="Custom priority" placeholder="What else matters?" value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTyped(); } }} />
          <select className="flh-input" aria-label="Custom priority category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((option) => <option key={option.key} value={option.key}>{option.title}</option>)}
          </select>
          <button type="button" className="flh-button flh-button-primary flh-button-small" disabled={!label.trim()} onClick={addTyped}>Add</button>
        </div>
      </section>
      <div className="flh-sheet-actions"><button type="button" className="flh-button flh-button-outline" onClick={onClose}>Done</button></div>
    </Sheet>
  );
}

// Focused editor for the participant's own priority levels. Edits stay in a local
// draft until "Save priorities" writes them through the existing savePriorities
// path (the participant's own search_member_priorities row); Cancel/Back discard.
export default function RankPrioritiesEditor({ search, userId, initialPriorities }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => normalizePriorities(initialPriorities));
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const levels = priorityLevels(draft);
  const count = selectedPriorityCount(draft);
  const leave = () => router.push('/search');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await savePriorities(createClient(), search, userId, draft);
      router.push('/search');
      router.refresh();
    } catch {
      setError('We couldn’t save your priorities. Your changes are still here—please try again.');
      setSaving(false);
    }
  };

  return (
    <MobilePage width="narrow" className="flh-has-action-bar">
      <SubpageHeader title="Rank Priorities" onBack={leave} onCancel={leave} />
      <HelperRow tone="quiet" icon={ArrowUpDown} title="Rank what matters to you" body="Drag a priority by its handle, or tap it to choose its level." />
      {error && <p className="hh-save-error" role="alert">{error}</p>}
      <RankBoard
        levels={levels}
        onMove={(item, tier) => setDraft((current) => moveCriterion(current, item.categoryKey, item.label, tier))}
        onRemove={(item) => setDraft((current) => moveCriterion(current, item.categoryKey, item.label, 'dontcare'))}
        garagePreference={draft.exterior?.garagePreference || 'any'}
        onGaragePreferenceChange={(value) => setDraft((current) => setGaragePreference(current, value))}
        schoolsNote={draft.location?.notes?.Schools || ''}
        onSchoolsNoteChange={(note) => setDraft((current) => ({ ...current, location: { ...current.location, notes: { ...current.location?.notes, Schools: note } } }))}
      />
      <button type="button" className="flh-button flh-button-outline flh-button-block" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add a priority</button>
      <HelperRow tone="sage" icon={ShieldCheck} body="Your levels shape how each home’s Match is weighed. Unknown details never count against a home." />
      <AddPrioritySheet open={adding} onClose={() => setAdding(false)} draft={draft} setDraft={setDraft} />
      <StickyActionBar note={`${count} ${count === 1 ? 'priority' : 'priorities'} · changes will update how your homes measure up`}>
        <button type="button" className="flh-button flh-button-primary flh-button-block" disabled={saving} onClick={save}><Check size={18} aria-hidden="true" /> {saving ? 'Saving…' : 'Save priorities'}</button>
      </StickyActionBar>
    </MobilePage>
  );
}
