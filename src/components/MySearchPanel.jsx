'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { TierPicker } from '@/components/ui';
import PriorityBoard from '@/components/PriorityBoard';
import CommuteDestinations from '@/components/CommuteDestinations';
import SchoolsRelevanceGate from '@/components/SchoolsRelevanceGate';
import CoBuyerManagement from '@/components/CoBuyerManagement';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import {
  MULTISELECT_CATEGORIES, SINGLESELECT_CATEGORIES, INVESTMENT_PROPERTY_TYPES, INVESTMENT_LIVING_PLAN_OPTIONS,
  showsMultiselectCategory, terminology, toggleWithNoPreference,
  normalizePriorities, searchExperienceLabel, getItemlistCategories, isApartmentRental,
} from '@/lib/constants';
import { PROPERTY_TYPE_LABELS, searchIntentCapabilities } from '@/lib/searchIntent';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { savePriorities } from '@/lib/supabase/collaboration';

// A soft, warm card shell — the same visual language established in Add/Edit Home's
// Property Details and Add More Details areas — reused here instead of inventing a
// second design system for My Search.
function SearchCard({ title, subtitle, showHeader = true, children }) {
  return (
    <section className="hh-search-card">
      {showHeader && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '3px 0 0' }}>{subtitle}</p>}
        </>
      )}
      <div style={{ marginTop: showHeader ? 14 : 0 }}>{children}</div>
    </section>
  );
}

function ObjectiveRow({ label, value, onValueChange, tier, onTierChange, placeholder, prefix, suffix, wide = false }) {
  return (
    <div className={`hh-basic-field ${wide ? 'hh-basic-field-wide' : ''}`}>
      <div>
        <div className="hh-label" style={{ marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {prefix && <span className="hh-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{prefix}</span>}
          <input className="hh-mono hh-value-input" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder={placeholder} />
          {suffix && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{suffix}</span>}
        </div>
      </div>
      <TierPicker value={tier} onChange={onTierChange} quiet ariaLabel={`${label} importance`} />
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
            <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[def.key] = { ...next[def.key], tier: t }; return next; })} quiet ariaLabel={`${def.title} importance`} />
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
        <TierPicker value={catState.tier} onChange={(t) => patch((next) => { next[key] = { ...next[key], tier: t }; return next; })} quiet ariaLabel={`${title} importance`} />
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
  const rooms = [p.bedsMin?.value && `${p.bedsMin.value}+ beds`, p.bathsMin?.value && `${p.bathsMin.value}+ baths`].filter(Boolean);
  if (rooms.length) lines.push(rooms.join(' · '));
  const space = [p.sqftTarget?.value && `${Number(p.sqftTarget.value).toLocaleString()}+ sq ft`, !isApartmentRental(p) && p.lotSizeTarget?.value && `${p.lotSizeTarget.value}+ acres`].filter(Boolean);
  if (space.length) lines.push(space.join(' · '));

  const layoutVals = (p.homeLayout?.values || []).filter((v) => v !== 'No Preference');
  if (layoutVals.length) lines.push(layoutVals.join(' or '));

  const conditionVals = (p.homeCondition?.values || []).filter((v) => v !== 'No Preference');
  if (conditionVals.length) lines.push(conditionVals.join(' or '));

  if (p.searchType === 'investment' && (p.investmentPropertyTypes || []).filter((v) => v !== 'No Preference').length) {
    lines.push(p.investmentPropertyTypes.filter((v) => v !== 'No Preference').join(' or '));
  }
  if (p.preferredPropertyTypes?.values?.length) {
    lines.push(p.preferredPropertyTypes.values.map((value) => PROPERTY_TYPE_LABELS[value] || value).join(' or '));
  }

  return lines;
}

// "What I'm Looking For" — the basic search requirements, shown as a settled summary
// by default with an Edit action revealing the same underlying fields as before.
function BasicsCard({ p, patch }) {
  const capabilities = searchIntentCapabilities(p.searchType);
  const hasBasics = !!(p.searchType || p.budget?.value || p.bedsMin?.value || p.bathsMin?.value || p.sqftTarget?.value);
  const [editOpen, setEditOpen] = useState(!hasBasics);
  const lines = buildBasicsSummary(p);

  return (
    <SearchCard title="What I'm Looking For">
      {!editOpen ? (
        <div>
          {p.searchType && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{searchExperienceLabel(p)}</div>}
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
          <div className="hh-basics-grid">
            <ObjectiveRow wide label={terminology(p.searchType).budgetLabel} prefix="$" value={p.budget.value} onValueChange={(v) => patch((n) => { n.budget = { ...n.budget, value: v }; return n; })} tier={p.budget.tier} onTierChange={(t) => patch((n) => { n.budget = { ...n.budget, tier: t }; return n; })} placeholder={terminology(p.searchType).pricePlaceholder} />
            <ObjectiveRow label="Minimum Square Footage" suffix="sqft" value={p.sqftTarget.value} onValueChange={(v) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: v }; return n; })} tier={p.sqftTarget.tier} onTierChange={(t) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, tier: t }; return n; })} placeholder="1,800" />
            {!isApartmentRental(p) && <ObjectiveRow label="Minimum Lot Size" suffix="acres" value={p.lotSizeTarget.value} onValueChange={(v) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: v }; return n; })} tier={p.lotSizeTarget.tier} onTierChange={(t) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, tier: t }; return n; })} placeholder="0.25" />}
            <ObjectiveRow label="Minimum Bedrooms" suffix="beds" value={p.bedsMin.value} onValueChange={(v) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: v }; return n; })} tier={p.bedsMin.tier} onTierChange={(t) => patch((n) => { n.bedsMin = { ...n.bedsMin, tier: t }; return n; })} placeholder="3" />
            <ObjectiveRow label="Minimum Bathrooms" suffix="baths" value={p.bathsMin.value} onValueChange={(v) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: v }; return n; })} tier={p.bathsMin.tier} onTierChange={(t) => patch((n) => { n.bathsMin = { ...n.bathsMin, tier: t }; return n; })} placeholder="2" />
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
                <TierPicker value={p.preferredPropertyTypes.tier} onChange={(tier) => patch((n) => { n.preferredPropertyTypes = { ...n.preferredPropertyTypes, tier }; return n; })} quiet ariaLabel="Property type importance" />
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '6px 0 0' }}>This shapes Match when a home's type is known; it never filters homes out.</p>
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

// The selected board is also the editing surface: discovery opens beneath it,
// so its resting portrait never transforms into a configuration panel. This
// is the page's primary purpose, so it renders in the wide left column (see
// .hh-search-primary) rather than as one supporting card among several.
function WhatMattersCard({ priorities, patch, catalogOpen, onCatalogOpenChange }) {
  return (
    <div>
    <SearchCard showHeader={false}>
      <p className="hh-label" style={{ marginBottom: 10 }}>What Matters Most to Me</p>
      <PriorityBoard priorities={priorities} patch={patch} catalogOpen={catalogOpen} onCatalogOpenChange={onCatalogOpenChange} />
    </SearchCard>
    </div>
  );
}

// Read-only content only — this always renders nested inside the single
// "Searching Together" card below, never as its own top-level card, so the
// collaboration story (connected state, collaborator summary, invite/manage
// action) reads as one calm section instead of three separately scattered
// ones. Deliberately a compact count summary ("3 Must Haves · 5 Important ·
// 6 Nice to Haves"), not an itemized list of the collaborator's actual
// priorities/places — that stays under their own control, never rendered
// here in detail. There is intentionally no "View {name}'s Criteria" link:
// unlike the Realtor workspace, a co-buyer has no dedicated read-only route
// to another participant's criteria today, and inventing one for this
// visual pass would be a real new data path, not a presentation change.
function CollaboratorContext({ context }) {
  if (!context) return null;
  const name = context.displayName || 'Your collaborator';
  const priorities = normalizePriorities(context.priorities);
  const boardItems = getItemlistCategories(priorities.searchType).flatMap((category) =>
    Object.entries(priorities[category.key]?.tiers || {})
      .filter(([, tier]) => tier && tier !== 'dontcare')
      .map(([, tier]) => ({ tier }))
  );
  const structured = [
    priorities.budget, priorities.bedsMin, priorities.bathsMin, priorities.sqftTarget,
    priorities.lotSizeTarget, priorities.preferredPropertyTypes, priorities.homeLayout, priorities.homeCondition,
  ].filter((value) => value?.tier && value.tier !== 'dontcare' && (value.value || value.values?.length))
    .map((value) => ({ tier: value.tier }));
  const items = [...structured, ...boardItems];
  const places = context.commuteDestinations || [];
  const countOf = (tier) => items.filter((item) => item.tier === tier).length;

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <p className="hh-serif" style={{ fontSize: 15, fontWeight: 700, color: 'var(--positive)', margin: '0 0 12px' }}>Connected with {name}.</p>
      {items.length ? (
        <div className="hh-collaborator-summary">
          <div><strong>{name}&apos;s priorities</strong><span>{countOf('must')} Must {countOf('must') === 1 ? 'Have' : 'Haves'} · {countOf('important')} Important · {countOf('nice')} Nice to {countOf('nice') === 1 ? 'Have' : 'Haves'}</span></div>
          <div><strong>{name}&apos;s places</strong><span>{places.length ? `${places.length} place${places.length === 1 ? '' : 's'} that matter` : 'No places added yet'}</span></div>
        </div>
      ) : (
        <p className="hh-detail-context">{name} hasn&apos;t added priorities yet.</p>
      )}
    </div>
  );
}

// One calm, consolidated section for the whole collaboration story: the
// connected state, the collaborator's read-only summary when present, and
// the one appropriate action (invite, or remove/leave) — instead of three
// fragments scattered across the page. The green "Searching together" pill
// in the canonical AppShell already says a search is collaborative; this
// section's job is to say something useful about that relationship, not
// repeat it. "The house is ours. The opinion is mine. The conversation is
// shared."
function SearchingTogetherCard({ search, userId, isOwner, participantCount, memberUserId, collaboratorContext }) {
  const isCollaborative = participantCount > 1;
  return (
    <SearchCard title="Searching Together">
      {isCollaborative ? (
        <>
          <CollaboratorContext context={collaboratorContext} />
          <div style={{ marginTop: 14 }}>
            <CoBuyerManagement userId={userId} search={search} isOwner={isOwner} participantCount={participantCount} memberUserId={memberUserId} collaboratorName={collaboratorContext?.displayName} />
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--ink)', margin: '0 0 4px' }}>You&apos;re searching alone.</p>
          {isOwner && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 12px' }}>Invite someone to compare the same homes while keeping each person&apos;s perspective under their own control. That&apos;s what FLH+ unlocks for this search.</p>
              <InviteCoBuyer searchId={search.id} userId={userId} />
            </>
          )}
        </>
      )}
    </SearchCard>
  );
}

export default function MySearchPanel({ search, userId, isOwner, participantCount, memberUserId, initialPriorities, initialCommuteDestinations, collaboratorContext = null, firstRun = false }) {
  const initial = normalizePriorities(initialPriorities);
  const persistPriorities = useCallback((next) => savePriorities(createClient(), search, userId, next), [search, userId]);
  const { state: priorities, patch, saveError, retry } = useReliableOptimisticState(initial, persistPriorities);
  const [commuteDestinations, setCommuteDestinations] = useState(initialCommuteDestinations || []);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const p = priorities;
  return (
    <>
      <div className="hh-search-layout">
        {saveError && <p className="hh-save-error" role="alert">{saveError} <button type="button" onClick={retry}>Retry</button></p>}
        {firstRun && <section className="hh-search-reveal hh-corner">
          <div><p className="hh-label">Your search is ready</p><h2 className="hh-serif">Here&apos;s what we heard.</h2><p>This is what Feels Like Home will use to Match your options. Nothing&apos;s set in stone—you can change your mind anytime.</p></div>
          <div className="hh-first-home-handoff"><strong>Looks good? Give us something to work with.</strong><p>Add a home you&apos;re considering and we&apos;ll show you how it stacks up.</p><Link className="hh-btn" href="/homes?add=1">Add your first home</Link></div>
        </section>}
        {/* Asymmetric two-column composition: "What Matters Most to Me" is
            this page's central purpose and takes the wide primary column;
            the basics summary, places, and collaboration status are
            supporting context in the narrower rail beside it. Collapses to
            a single stacked column at the existing @media (max-width: 900px)
            boundary (see globals.css), same breakpoint the priority-tiers
            grid inside it already collapses at. */}
        <div className="hh-search-grid">
          <div className="hh-search-primary">
            <WhatMattersCard priorities={p} patch={patch} catalogOpen={catalogOpen} onCatalogOpenChange={setCatalogOpen} />
          </div>
          <div className="hh-search-rail">
            <BasicsCard p={p} patch={patch} />

            <SearchCard title="Places That Matter" subtitle="We'll calculate commute times from every home to the places that matter to you.">
              {!commuteDestinations.length && <div className="hh-places-empty"><strong>Got somewhere you go all the time?</strong><p>Add work, family, school—or anywhere else—and we&apos;ll compare the trip from every home.</p></div>}
              <CommuteDestinations searchId={search.id} userId={userId} destinations={commuteDestinations} onChange={setCommuteDestinations} hideHeader startCollapsedWhenEmpty />
            </SearchCard>

            <SearchingTogetherCard
              search={search}
              userId={userId}
              isOwner={isOwner}
              participantCount={participantCount}
              memberUserId={memberUserId}
              collaboratorContext={collaboratorContext}
            />
          </div>
        </div>
      </div>

      <section className="hh-match-editorial hh-match-editorial-search">
        <div className="hh-match-editorial-inner">
          <div className="hh-match-editorial-copy">
            <h2>How Match Scores Work</h2>
            <p>Each home is measured against your Must Haves, Important priorities, Nice to Haves, and places that matter. When you&apos;re searching together, each person keeps their own Match — so you can see where your priorities line up and where they don&apos;t.</p>
          </div>
          <div className="hh-match-editorial-visual">
            <img className="hh-match-editorial-art" src="/images/FWFLH%20Transparent.png" alt="" aria-hidden="true" />
          </div>
        </div>
      </section>
    </>
  );
}
