'use client';

import { useState } from 'react';
import { TierPicker } from '@/components/ui';
import CriteriaPicker from '@/components/CriteriaPicker';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, INVESTMENT_PROPERTY_TYPES, INVESTMENT_LIVING_PLAN_OPTIONS,
  isSimpleRentalType, showsHomeLayout, terminology, nextInvestmentTypes, getItemlistCategories,
} from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { updateSearchPriorities } from '@/lib/supabase/data';

function ObjectiveRow({ label, value, onValueChange, tier, onTierChange, placeholder, prefix, suffix }) {
  return (
    <div className="hh-priority-row" style={{ alignItems: 'center' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div className="hh-label" style={{ marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {prefix && <span className="hh-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{prefix}</span>}
          <input className="hh-mono hh-value-input" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
          {suffix && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{suffix}</span>}
        </div>
      </div>
      <TierPicker value={tier} onChange={onTierChange} />
    </div>
  );
}

function MultiselectSection({ def, priorities, patch }) {
  const { key, title, options } = def;
  const catState = priorities[key] || { values: [], tier: 'dontcare' };
  const toggle = (opt) => patch((next) => { const cur = next[key].values; next[key] = { ...next[key], values: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] }; return next; });
  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{title}</h3>
      <div className="hh-priority-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => <span key={o} className={`hh-chip ${catState.values.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)}>{o}</span>)}
        </div>
        <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[key] = { ...next[key], tier: t }; return next; })} />
      </div>
    </section>
  );
}

function BedroomPreferencesSection({ priorities, patch }) {
  return (
    <section>
      <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Bedroom Preferences</h3>
      {SINGLESELECT_CATEGORIES.map((def) => {
        const catState = priorities[def.key] || { value: '', tier: 'dontcare' };
        return (
          <div className="hh-priority-row" key={def.key} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{def.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {def.options.map((o) => (
                  <span key={o} className={`hh-chip ${catState.value === o ? 'on' : ''}`} onClick={() => patch((next) => {
                    const wasSelected = next[def.key].value === o;
                    const newValue = wasSelected ? '' : o;
                    const newTier = !wasSelected && o === 'Either / No Preference' ? 'dontcare' : next[def.key].tier;
                    next[def.key] = { ...next[def.key], value: newValue, tier: newTier };
                    return next;
                  })}>{o}</span>
                ))}
              </div>
            </div>
            <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[def.key] = { ...next[def.key], tier: t }; return next; })} />
          </div>
        );
      })}
    </section>
  );
}

export default function MySearchPanel({ searchId, initialPriorities }) {
  const [priorities, setPriorities] = useState(initialPriorities);

  const patch = (updater) => {
    setPriorities((prev) => {
      const next = updater({ ...prev });
      const supabase = createClient();
      updateSearchPriorities(supabase, searchId, next).catch((e) => console.error('Could not save priorities', e));
      return next;
    });
  };

  const p = priorities;
  const categories = getItemlistCategories(p.searchType);

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 760 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
        Selected = you care about it. Everything else stays out of your matches. Change importance, remove something, or add more anytime.
      </p>

      <section>
        <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Budget &amp; Basics</h3>
        <ObjectiveRow label={terminology(p.searchType).budgetLabel} prefix="$" value={p.budget.value} onValueChange={(v) => patch((n) => { n.budget = { ...n.budget, value: v }; return n; })} tier={p.budget.tier} onTierChange={(t) => patch((n) => { n.budget = { ...n.budget, tier: t }; return n; })} placeholder={terminology(p.searchType).pricePlaceholder} />
        <ObjectiveRow label="Minimum Square Footage" suffix="sqft" value={p.sqftTarget.value} onValueChange={(v) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: v }; return n; })} tier={p.sqftTarget.tier} onTierChange={(t) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, tier: t }; return n; })} placeholder="1,800" />
        {!isSimpleRentalType(p.searchType) && <ObjectiveRow label="Minimum Lot Size" suffix="acres" value={p.lotSizeTarget.value} onValueChange={(v) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: v }; return n; })} tier={p.lotSizeTarget.tier} onTierChange={(t) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, tier: t }; return n; })} placeholder="0.25" />}
        <ObjectiveRow label="Minimum Bedrooms" suffix="beds" value={p.bedsMin.value} onValueChange={(v) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: v }; return n; })} tier={p.bedsMin.tier} onTierChange={(t) => patch((n) => { n.bedsMin = { ...n.bedsMin, tier: t }; return n; })} placeholder="3" />
        <ObjectiveRow label="Minimum Bathrooms" suffix="baths" value={p.bathsMin.value} onValueChange={(v) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: v }; return n; })} tier={p.bathsMin.tier} onTierChange={(t) => patch((n) => { n.bathsMin = { ...n.bathsMin, tier: t }; return n; })} placeholder="2" />
      </section>

      {p.searchType === 'investment' && (
        <section>
          <h3 className="hh-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Investment Property Type</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {INVESTMENT_PROPERTY_TYPES.map((opt) => (
              <span key={opt} className={`hh-chip ${(p.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`}
                onClick={() => patch((n) => { n.investmentPropertyTypes = nextInvestmentTypes(n.investmentPropertyTypes || [], opt); return n; })}>
                {opt}
              </span>
            ))}
          </div>
          <div className="hh-label" style={{ marginBottom: 6 }}>Planning to live in the property?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {INVESTMENT_LIVING_PLAN_OPTIONS.map((o) => (
              <span key={o.key} className={`hh-chip ${p.planningToLiveIn === o.key ? 'on' : ''}`}
                onClick={() => patch((n) => { n.planningToLiveIn = n.planningToLiveIn === o.key ? '' : o.key; return n; })}>
                {o.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {showsHomeLayout(p.searchType) && MULTISELECT_CATEGORIES.map((def) => <MultiselectSection key={def.key} def={def} priorities={p} patch={patch} />)}
      <BedroomPreferencesSection priorities={p} patch={patch} />
      {categories.map((def) => <CriteriaPicker key={def.key} def={def} priorities={p} patch={patch} draggable />)}
    </div>
  );
}
