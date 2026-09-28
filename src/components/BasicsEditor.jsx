'use client';

import Link from 'next/link';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, INVESTMENT_PROPERTY_TYPES, INVESTMENT_LIVING_PLAN_OPTIONS,
  showsMultiselectCategory, terminology, toggleWithNoPreference, isApartmentRental,
} from '@/lib/constants';
import { PROPERTY_TYPE_LABELS, searchIntentCapabilities } from '@/lib/searchIntent';
import { sanitizeNumericInput } from '@/lib/searchProfile';

// The "What I'm Looking For" editor: the search definition (Search Basics).
// Basics are factual guideposts, not Match weights — there is no importance
// picker here, and computeMatch never reads them (see evaluateSearchBasics).
// Any tier still stored on a Basic from before is left untouched and unused.
// My Search opens it in a Sheet; it autosaves through the same
// patch/savePriorities path Onboarding uses.
function ObjectiveRow({ label, value, onValueChange, placeholder, prefix, suffix, wide = false, decimal = false }) {
  return (
    <div className={`hh-basic-field ${wide ? 'hh-basic-field-wide' : ''}`}>
      <div>
        <div className="hh-label" style={{ marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {prefix && <span className="hh-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{prefix}</span>}
          <input className="hh-mono hh-value-input" inputMode={decimal ? 'decimal' : 'numeric'} value={value} onChange={(e) => onValueChange(sanitizeNumericInput(e.target.value, { decimal }))} placeholder={placeholder} />
          {suffix && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{suffix}</span>}
        </div>
      </div>
    </div>
  );
}

// Primary/Secondary bedroom pickers, rendered as a visually subordinate block — used only
// nested beneath Home Layout, never as its own top-level section.
function BedroomSubPreferences({ priorities, patch }) {
  return (
    <details className="hh-specific-preferences">
      <summary>More specific layout preferences</summary>
      {SINGLESELECT_CATEGORIES.map((def) => {
        const catState = priorities[def.key] || { value: '', tier: 'dontcare' };
        return (
          <div className="hh-priority-row" key={def.key} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{def.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {def.options.map((o) => (
                  <button type="button" key={o} className={`hh-chip ${catState.value === o ? 'on' : ''}`} aria-pressed={catState.value === o} onClick={() => patch((next) => {
                    const wasSelected = next[def.key].value === o;
                    const newValue = wasSelected ? '' : o;
                    const newTier = !wasSelected && o === 'No Preference' ? 'dontcare' : next[def.key].tier;
                    next[def.key] = { ...next[def.key], value: newValue, tier: newTier };
                    return next;
                  })}>{o}</button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </details>
  );
}

function MultiselectSection({ def, priorities, patch, children }) {
  const { key, title, options } = def;
  const catState = priorities[key] || { values: [], tier: 'dontcare' };
  // catState could still be a TRUTHY but malformed object here (missing
  // .values) if priorities[key] exists but isn't shaped correctly — the
  // `|| {...}` fallback above only substitutes on falsy, not on malformed-
  // but-truthy. This is the one gap found in the exhaustive re-audit that
  // wasn't already covered by the normalizePriorities hardening or the other
  // guarded call sites. Logging only fires in this exact malformed case, so
  // if this is still reachable live, the next occurrence gives definitive
  // proof of the actual shape instead of another guess.
  if (!Array.isArray(catState.values)) {
    console.error('[MultiselectSection] malformed catState.values for key', key, '— raw value was:', priorities[key]);
  }
  const safeValues = Array.isArray(catState.values) ? catState.values : [];
  const toggle = (opt) => patch((next) => {
    const cur = next[key].values || [];
    const nextValues = options.includes('No Preference') ? toggleWithNoPreference(cur, opt) : (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
    next[key] = { ...next[key], values: nextValues };
    return next;
  });
  return (
    <div style={{ marginTop: 18 }}>
      <div className="hh-label" style={{ marginBottom: 6 }}>{title}</div>
      <div className="hh-priority-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => <button type="button" key={o} className={`hh-chip ${safeValues.includes(o) ? 'on' : ''}`} aria-pressed={safeValues.includes(o)} onClick={() => toggle(o)}>{o}</button>)}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function BasicsEditor({ priorities: p, patch }) {
  const capabilities = searchIntentCapabilities(p.searchType);
  return (
    <div className="flh-basics-editor">
          <p className="flh-basics-intro">Search Basics define what you’re looking for. They show up as facts on every home — they aren’t weighted in Match. Rank what matters in <Link href="/search/priorities">Rank priorities</Link>.</p>
          <div className="hh-basics-grid">
            <ObjectiveRow wide label={terminology(p.searchType).budgetLabel} prefix="$" value={p.budget.value} onValueChange={(v) => patch((n) => { n.budget = { ...n.budget, value: v }; return n; })} placeholder={terminology(p.searchType).pricePlaceholder} />
            <ObjectiveRow label="Minimum Square Footage" suffix="sqft" value={p.sqftTarget.value} onValueChange={(v) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: v }; return n; })} placeholder="1,800" />
            {!isApartmentRental(p) && <ObjectiveRow decimal label="Minimum Lot Size" suffix="acres" value={p.lotSizeTarget.value} onValueChange={(v) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: v }; return n; })} placeholder="0.25" />}
            <ObjectiveRow label="Minimum Bedrooms" suffix="beds" value={p.bedsMin.value} onValueChange={(v) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: v }; return n; })} placeholder="3" />
            <ObjectiveRow decimal label="Minimum Bathrooms" suffix="baths" value={p.bathsMin.value} onValueChange={(v) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: v }; return n; })} placeholder="2" />
          </div>

          {p.searchType === 'investment' && (
            <div style={{ marginTop: 18 }}>
              <div className="hh-label" style={{ marginBottom: 6 }}>Investment Property Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {INVESTMENT_PROPERTY_TYPES.map((opt) => (
                  <button type="button" key={opt} className={`hh-chip ${(p.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`} aria-pressed={(p.investmentPropertyTypes || []).includes(opt)}
                    onClick={() => patch((n) => { n.investmentPropertyTypes = toggleWithNoPreference(n.investmentPropertyTypes || [], opt); return n; })}>
                    {opt}
                  </button>
                ))}
              </div>
              <div className="hh-label" style={{ marginBottom: 6 }}>Planning to live in the property?</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {INVESTMENT_LIVING_PLAN_OPTIONS.map((o) => (
                  <button type="button" key={o.key} className={`hh-chip ${p.planningToLiveIn === o.key ? 'on' : ''}`} aria-pressed={p.planningToLiveIn === o.key}
                    onClick={() => patch((n) => { n.planningToLiveIn = n.planningToLiveIn === o.key ? '' : o.key; return n; })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(capabilities.isPurchase || capabilities.isRental) && (
            <div style={{ marginTop: 18 }}>
              <div className="hh-label" style={{ marginBottom: 6 }}>What kinds of homes are you considering? <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
              <div className="hh-priority-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 220px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {capabilities.preferredPropertyTypeOptions.map((value) => {
                    const selected = p.preferredPropertyTypes.values.includes(value);
                    return <button type="button" key={value} className={`hh-chip ${selected ? 'on' : ''}`} aria-pressed={selected}
                      onClick={() => patch((n) => { const values = n.preferredPropertyTypes.values || []; n.preferredPropertyTypes = { ...n.preferredPropertyTypes, values: selected ? values.filter((item) => item !== value) : [...values, value] }; return n; })}>
                      {PROPERTY_TYPE_LABELS[value]}
                    </button>;
                  })}
                </div>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '6px 0 0' }}>Shown as a fact on each home; it never filters homes out.</p>
            </div>
          )}

          {MULTISELECT_CATEGORIES.filter((def) => showsMultiselectCategory(def.key, p.searchType)).map((def) => (
            <MultiselectSection key={def.key} def={def} priorities={p} patch={patch}>
              {def.key === 'homeLayout' && <BedroomSubPreferences priorities={p} patch={patch} />}
            </MultiselectSection>
          ))}

    </div>
  );
}
