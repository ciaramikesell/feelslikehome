'use client';

import { useId, useState } from 'react';
import {
  AirVent, ArrowRight, ArrowUpDown, BedDouble, Building, Building2, Car, Check, ChevronDown, Columns2, Dumbbell, EyeOff, Fence,
  Hammer, HardHat, Hotel, House, Laptop, Layers, Leaf, PaintRoller, PawPrint, Plus, PlugZap, Route, Rows2, School, Shapes,
  ShieldCheck, Sofa, Sparkles, SquareParking, Store, Sun, Trees, Utensils, VolumeX, WashingMachine, Waves,
} from 'lucide-react';
import { customCategoryOptions, moveCriterion, priorityLevels, toggleCriterion, addCustomCriterion } from '@/lib/searchProfile';
import { flatOnboardingSuggestions } from '@/lib/onboarding';
import { toggleGroupValue } from '@/lib/whatMattersGroups';
import { chipKey, isChipSelected, moreToConsider, offeredChips, picksCount, whatMattersSections } from '@/lib/whatMattersCatalog';
import { searchExperienceKey } from '@/lib/searchProfile';

// Step 4 of Onboarding V2: "What matters most?" (approved Figma design).
//
// This step only answers "what matters to me?". A chip adds the existing
// priority at Important (Step 5 decides how important); an already-saved
// priority keeps its level. Nothing here says anything about a particular
// home. See src/lib/whatMattersCatalog.js for the chip → canonical ID mapping.

const ICONS = {
  AirVent, ArrowUpDown, BedDouble, Building, Building2, Car, Columns2, Dumbbell, EyeOff, Fence, Hammer, HardHat, Hotel, House,
  Laptop, Layers, Leaf, PaintRoller, PawPrint, PlugZap, Route, Rows2, School, Shapes, ShieldCheck, Sofa, Sparkles, SquareParking,
  Store, Sun, Trees, Utensils, VolumeX, WashingMachine, Waves,
};

function Chip({ chip, selected, onToggle }) {
  const Icon = (chip.icon && ICONS[chip.icon]) || null;
  return (
    <button type="button" className={`flh-ob-chip${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onToggle}>
      {selected ? <Check size={16} strokeWidth={2.2} aria-hidden="true" /> : Icon ? <Icon size={16} strokeWidth={1.7} aria-hidden="true" /> : null}
      <span>{chip.text}</span>
      {chip.afterTour && <span className="flh-ob-chip-tag">after tour</span>}
    </button>
  );
}

function MoreToConsider({ chips, isSelected, onToggle }) {
  const id = useId();
  const chosen = chips.filter(isSelected).length;
  const [open, setOpen] = useState(chosen > 0);
  if (!chips.length) return null;
  return (
    <div className={`flh-ob-more${open ? ' is-open' : ''}`}>
      <button type="button" className="flh-ob-more-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>
          <span className="flh-ob-more-title">More to consider</span>
          <span className="flh-ob-more-summary">{chosen ? `${chosen} chosen` : 'Other things you can weigh'}</span>
        </span>
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <div id={id} className="flh-ob-chips flh-ob-more-panel" hidden={!open}>
        {chips.map((chip) => <Chip key={chipKey(chip)} chip={chip} selected={isSelected(chip)} onToggle={() => onToggle(chip)} />)}
      </div>
    </div>
  );
}

export default function WhatMattersStepV2({ header, priorities, patch, onNext, isSaving }) {
  const sections = whatMattersSections(priorities);
  const more = moreToConsider(priorities);
  const isSelected = (chip) => isChipSelected(priorities, chip);
  const toggle = (chip) => patch((next) => (chip.type === 'criterion'
    ? toggleCriterion(next, { categoryKey: chip.categoryKey, label: chip.label, kind: chip.kind })
    : toggleGroupValue(next, chip.group, chip.value)));
  const shownKeys = new Set([...sections.flatMap((section) => section.chips), ...more].map(chipKey));
  // Anything already chosen that isn't a chip here — the person's own typed
  // priorities and earlier selections — stays visible and removable.
  const ownItems = priorityLevels(priorities).flatMap((level) => level.items).filter((item) => !shownKeys.has(item.key));
  const picks = picksCount(priorities);

  const categories = customCategoryOptions(priorities);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customCategory, setCustomCategory] = useState(categories[0]?.key || 'location');
  const addCustom = () => {
    if (!customLabel.trim()) return;
    // A typed label that matches something offered here selects that instead.
    const offered = [
      ...flatOnboardingSuggestions(searchExperienceKey(priorities)),
      ...offeredChips(priorities).filter((chip) => chip.type === 'criterion').map((chip) => ({ categoryKey: chip.categoryKey, label: chip.label, kind: chip.kind, displayLabel: chip.text })),
    ];
    patch((next) => addCustomCriterion(next, customCategory, customLabel, offered));
    setCustomLabel('');
    setCustomOpen(false);
  };

  return (
    <div className="flh-onboarding-step flh-ob-matters">
      {header}
      {sections.map((section, index) => (
        <section key={section.key} className="flh-ob-matters-section" aria-labelledby={`flh-ob-matters-${section.key}`}>
          <h2 id={`flh-ob-matters-${section.key}`} className="flh-ob-matters-title">
            <span className="flh-ob-matters-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            {section.title}
          </h2>
          {section.note && <p className="flh-ob-matters-note">{section.note}</p>}
          <div className="flh-ob-chips">
            {section.chips.map((chip) => <Chip key={chipKey(chip)} chip={chip} selected={isSelected(chip)} onToggle={() => toggle(chip)} />)}
          </div>
        </section>
      ))}
      <MoreToConsider chips={more} isSelected={isSelected} onToggle={toggle} />
      {ownItems.length > 0 && (
        <section className="flh-ob-matters-section" aria-labelledby="flh-ob-matters-own">
          <h2 id="flh-ob-matters-own" className="flh-ob-matters-title">Your own</h2>
          <div className="flh-ob-chips">
            {ownItems.map((item) => (
              <Chip key={item.key} chip={{ text: item.displayLabel }} selected onToggle={() => patch((next) => moveCriterion(next, item.categoryKey, item.label, 'dontcare'))} />
            ))}
          </div>
        </section>
      )}
      {!customOpen ? (
        <button type="button" className="flh-ob-add-own" onClick={() => setCustomOpen(true)}><Plus size={16} aria-hidden="true" /> Add your own</button>
      ) : (
        <div className="flh-ob-own-form">
          <label className="flh-ob-sublabel" htmlFor="flh-ob-own-label">What else matters?</label>
          <span className="flh-ob-input"><input id="flh-ob-own-label" autoFocus placeholder="e.g. Mudroom" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} /></span>
          <select className="flh-ob-own-category" aria-label="Category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>
            {categories.map((category) => <option key={category.key} value={category.key}>{category.title}</option>)}
          </select>
          <div className="flh-ob-place-actions">
            <button type="button" className="flh-text-action" onClick={() => setCustomOpen(false)}>Cancel</button>
            <button type="button" className="flh-button flh-button-primary flh-button-small" disabled={!customLabel.trim()} onClick={addCustom}>Add</button>
          </div>
        </div>
      )}
      <nav className="flh-onboarding-actions flh-ob-matters-actions" aria-label="Step actions">
        <span className="flh-ob-picks" aria-live="polite"><strong>{picks}</strong><span>{picks === 1 ? 'pick' : 'picks'}</span></span>
        <button type="button" className={`flh-button flh-ob-cta ${picks ? 'flh-button-primary' : 'flh-ob-cta-quiet'}`} disabled={isSaving} onClick={onNext}>
          <span>{isSaving ? 'Saving…' : picks ? 'Rank my priorities' : 'Skip for now'}</span>
          <span className="flh-ob-cta-icon" aria-hidden="true"><ArrowRight size={20} strokeWidth={2.2} /></span>
        </button>
      </nav>
    </div>
  );
}
