'use client';

import { useState } from 'react';
import { TierPicker } from '@/components/ui';
import CriteriaPicker from '@/components/CriteriaPicker';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, INVESTMENT_PROPERTY_TYPES, INVESTMENT_LIVING_PLAN_OPTIONS,
  isSimpleRentalType, showsMultiselectCategory, terminology, toggleWithNoPreference, getItemlistCategories,
  normalizePriorities, searchTypeLabel, TIER_META,
} from '@/lib/constants';
import { selectedOrderedItems } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { updateSearchPriorities } from '@/lib/supabase/data';

// A soft, warm card shell — the same visual language established in Add/Edit Home's
// Property Details and Add More Details areas — reused here instead of inventing a
// second design system for My Search.
function SearchCard({ title, subtitle, showHeader = true, children }) {
  return (
    <section style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 16, padding: '18px 20px' }}>
      {showHeader && (
        <>
          <h3 className="hh-serif" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '3px 0 0' }}>{subtitle}</p>}
        </>
      )}
      <div style={{ marginTop: showHeader ? 14 : 0 }}>{children}</div>
    </section>
  );
}

function ObjectiveRow({ label, value, onValueChange, tier, onTierChange, placeholder, prefix, suffix }) {
  return (
    <div className="hh-priority-row" style={{ alignItems: 'center' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div className="hh-label" style={{ marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {prefix && <span className="hh-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{prefix}</span>}
          <input className="hh-mono hh-value-input" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
          {suffix && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{suffix}</span>}
        </div>
      </div>
      <TierPicker value={tier} onChange={onTierChange} />
    </div>
  );
}

// Primary/Secondary bedroom pickers, rendered as a visually subordinate block — used only
// nested beneath Home Layout, never as its own top-level section.
function BedroomSubPreferences({ priorities, patch }) {
  return (
    <div style={{ marginTop: 14, paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.03em' }}>Bedroom Preferences</div>
      {SINGLESELECT_CATEGORIES.map((def) => {
        const catState = priorities[def.key] || { value: '', tier: 'dontcare' };
        return (
          <div className="hh-priority-row" key={def.key} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{def.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {def.options.map((o) => (
                  <span key={o} className={`hh-chip ${catState.value === o ? 'on' : ''}`} onClick={() => patch((next) => {
                    const wasSelected = next[def.key].value === o;
                    const newValue = wasSelected ? '' : o;
                    const newTier = !wasSelected && o === 'No Preference' ? 'dontcare' : next[def.key].tier;
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
    </div>
  );
}

function MultiselectSection({ def, priorities, patch, children }) {
  const { key, title, options } = def;
  const catState = priorities[key] || { values: [], tier: 'dontcare' };
  const toggle = (opt) => patch((next) => {
    const cur = next[key].values;
    const nextValues = options.includes('No Preference') ? toggleWithNoPreference(cur, opt) : (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
    next[key] = { ...next[key], values: nextValues };
    return next;
  });
  return (
    <div style={{ marginTop: 18 }}>
      <div className="hh-label" style={{ marginBottom: 6 }}>{title}</div>
      <div className="hh-priority-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => <span key={o} className={`hh-chip ${catState.values.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)}>{o}</span>)}
        </div>
        <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[key] = { ...next[key], tier: t }; return next; })} />
      </div>
      {children}
    </div>
  );
}

// Compact, read-only lines summarizing the basic search — only what's actually set,
// never empty placeholder rows, and never raw field names.
function buildBasicsSummary(p) {
  const lines = [];
  const rental = terminology(p.searchType).priceFieldLabel.toLowerCase().includes('rent');
  if (p.budget?.value) lines.push(`Up to $${Number(p.budget.value).toLocaleString()}${rental ? '/mo' : ''}`);

  const thresholds = [
    p.bedsMin?.value ? `${p.bedsMin.value}+ beds` : null,
    p.bathsMin?.value ? `${p.bathsMin.value}+ baths` : null,
    p.sqftTarget?.value ? `${Number(p.sqftTarget.value).toLocaleString()}+ sq ft` : null,
  ].filter(Boolean);
  if (thresholds.length) lines.push(thresholds.join(' · '));

  if (!isSimpleRentalType(p.searchType) && p.lotSizeTarget?.value) lines.push(`${p.lotSizeTarget.value}+ acre lot`);

  const layoutVals = (p.homeLayout?.values || []).filter((v) => v !== 'No Preference');
  if (layoutVals.length) lines.push(layoutVals.join(' or '));

  const conditionVals = (p.homeCondition?.values || []).filter((v) => v !== 'No Preference');
  if (conditionVals.length) lines.push(conditionVals.join(' or '));

  if (p.searchType === 'investment' && (p.investmentPropertyTypes || []).filter((v) => v !== 'No Preference').length) {
    lines.push(p.investmentPropertyTypes.filter((v) => v !== 'No Preference').join(' or '));
  }

  return lines;
}

// "What I'm looking for" — the basic search requirements, shown as a settled summary
// by default with an Edit action revealing the same underlying fields as before.
function BasicsCard({ p, patch }) {
  const hasBasics = !!(p.searchType || p.budget?.value || p.bedsMin?.value || p.bathsMin?.value || p.sqftTarget?.value);
  const [editOpen, setEditOpen] = useState(!hasBasics);
  const lines = buildBasicsSummary(p);

  return (
    <SearchCard title="What I'm looking for">
      {!editOpen ? (
        <div>
          {p.searchType && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{searchTypeLabel(p.searchType)}</div>}
          {lines.length > 0 ? (
            <div style={{ display: 'grid', gap: 3 }}>
              {lines.map((line, i) => <div key={i} style={{ fontSize: 13.5, color: 'var(--ink)' }}>{line}</div>)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nothing set yet.</div>
          )}
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', marginTop: 12 }} onClick={() => setEditOpen(true)}>
            Edit
          </button>
        </div>
      ) : (
        <div>
          <ObjectiveRow label={terminology(p.searchType).budgetLabel} prefix="$" value={p.budget.value} onValueChange={(v) => patch((n) => { n.budget = { ...n.budget, value: v }; return n; })} tier={p.budget.tier} onTierChange={(t) => patch((n) => { n.budget = { ...n.budget, tier: t }; return n; })} placeholder={terminology(p.searchType).pricePlaceholder} />
          <ObjectiveRow label="Minimum Square Footage" suffix="sqft" value={p.sqftTarget.value} onValueChange={(v) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: v }; return n; })} tier={p.sqftTarget.tier} onTierChange={(t) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, tier: t }; return n; })} placeholder="1,800" />
          {!isSimpleRentalType(p.searchType) && <ObjectiveRow label="Minimum Lot Size" suffix="acres" value={p.lotSizeTarget.value} onValueChange={(v) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: v }; return n; })} tier={p.lotSizeTarget.tier} onTierChange={(t) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, tier: t }; return n; })} placeholder="0.25" />}
          <ObjectiveRow label="Minimum Bedrooms" suffix="beds" value={p.bedsMin.value} onValueChange={(v) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: v }; return n; })} tier={p.bedsMin.tier} onTierChange={(t) => patch((n) => { n.bedsMin = { ...n.bedsMin, tier: t }; return n; })} placeholder="3" />
          <ObjectiveRow label="Minimum Bathrooms" suffix="baths" value={p.bathsMin.value} onValueChange={(v) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: v }; return n; })} tier={p.bathsMin.tier} onTierChange={(t) => patch((n) => { n.bathsMin = { ...n.bathsMin, tier: t }; return n; })} placeholder="2" />

          {p.searchType === 'investment' && (
            <div style={{ marginTop: 18 }}>
              <div className="hh-label" style={{ marginBottom: 6 }}>Investment Property Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {INVESTMENT_PROPERTY_TYPES.map((opt) => (
                  <span key={opt} className={`hh-chip ${(p.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`}
                    onClick={() => patch((n) => { n.investmentPropertyTypes = toggleWithNoPreference(n.investmentPropertyTypes || [], opt); return n; })}>
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
            </div>
          )}

          {MULTISELECT_CATEGORIES.filter((def) => showsMultiselectCategory(def.key, p.searchType)).map((def) => (
            <MultiselectSection key={def.key} def={def} priorities={p} patch={patch}>
              {def.key === 'homeLayout' && <BedroomSubPreferences priorities={p} patch={patch} />}
            </MultiselectSection>
          ))}

          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', marginTop: 16 }} onClick={() => setEditOpen(false)}>
            Done
          </button>
        </div>
      )}
    </SearchCard>
  );
}

// One "What matters to me" category — a settled list of what's already selected by
// default, with importance shown as restrained text (not a wall of pills), and the
// full existing CriteriaPicker (tiers, tray, custom add, reordering) tucked behind
// "Edit priorities" for anyone who wants to change something.
function PriorityCard({ def, priorities, patch }) {
  const selected = selectedOrderedItems(def, priorities);
  const [editOpen, setEditOpen] = useState(selected.length === 0);

  return (
    <SearchCard title={def.title} subtitle={def.blurb} showHeader={!editOpen}>
      {!editOpen ? (
        <div>
          {selected.length > 0 ? (
            <div style={{ display: 'grid' }}>
              {selected.map((item) => {
                const tier = priorities[def.key]?.tiers?.[item.label] || 'dontcare';
                const must = tier === 'must';
                return (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{item.label}</span>
                    <span style={{ fontSize: 11.5, fontWeight: must ? 700 : 500, color: must ? 'var(--brick)' : 'var(--ink-soft)' }}>{TIER_META[tier]?.label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nothing selected yet.</div>
          )}
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', marginTop: 12 }} onClick={() => setEditOpen(true)}>
            {selected.length > 0 ? 'Edit priorities' : '+ Add a priority'}
          </button>
        </div>
      ) : (
        <div>
          <CriteriaPicker def={def} priorities={priorities} patch={patch} draggable />
          <button type="button" className="hh-btn hh-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', marginTop: 4 }} onClick={() => setEditOpen(false)}>
            Done
          </button>
        </div>
      )}
    </SearchCard>
  );
}

export default function MySearchPanel({ searchId, initialPriorities }) {
  const [priorities, setPriorities] = useState(() => normalizePriorities(initialPriorities));

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
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 4px', lineHeight: 1.5 }}>
        Here's what Feels Like Home knows about what you're looking for. Selected priorities are the only things that affect your Match — change importance, remove something, or add more anytime.
      </p>

      <BasicsCard p={p} patch={patch} />

      {categories.map((def) => <PriorityCard key={def.key} def={def} priorities={p} patch={patch} />)}
    </div>
  );
}
