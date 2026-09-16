'use client';

import Link from 'next/link';
import { Heart, Footprints, Star, Archive, Users } from 'lucide-react';
import { normalizePriorities, TIER_META, TOUR_RATING_KEY, getItemlistCategories, effectiveTier, criterionDisplayLabel } from '@/lib/constants';
import { splitCategoryItems } from '@/lib/matching';
import { computeMatch, matchColor } from '@/lib/matching';
import { homeIdentity } from '@/lib/homePresentation';
import { formatHomePrice } from '@/lib/homeDisplay';
import RealtorSuggestHome from '@/components/RealtorSuggestHome';

const CORE = [
  ['preferredPropertyTypes', 'Property type'], ['budget', 'Budget'], ['bedsMin', 'Bedrooms'],
  ['bathsMin', 'Bathrooms'], ['sqftTarget', 'Square footage'], ['lotSizeTarget', 'Lot size'],
  ['homeLayout', 'Home layout'], ['homeCondition', 'Home condition'],
  ['primaryBedroomLocation', 'Primary bedroom location'], ['secondaryBedroomLocation', 'Secondary bedrooms'],
];

function priorityBuckets(raw) {
  const p = normalizePriorities(raw);
  const items = CORE.flatMap(([key, label]) => {
    const value = p[key];
    const tier = value?.tier || 'dontcare';
    if (tier === 'dontcare') return [];
    const detail = value?.value || value?.values?.join(', ') || '';
    return [{ key, label, detail, tier }];
  });
  getItemlistCategories(p.searchType).forEach((definition) => {
    const { core, custom } = splitCategoryItems(definition, p);
    [...core, ...custom].forEach((item) => {
      const tier = effectiveTier(definition.key, item.label, p, p[definition.key]?.tiers?.[item.label]);
      if (tier !== 'dontcare') items.push({ key: `${definition.key}:${item.label}`, label: criterionDisplayLabel(definition.key, item.label), detail: '', tier });
    });
  });
  return ['must', 'important', 'nice'].map((tier) => ({ tier, items: items.filter((item) => item.tier === tier) }));
}

function Priorities({ person, priorities }) {
  const buckets = priorityBuckets(priorities);
  return <section className="hh-realtor-priorities" aria-label={`${person.display_name}'s priorities`}>
    <div className="hh-realtor-person-label">{person.display_name} <span>{person.relationship}</span></div>
    <div className="hh-realtor-priority-grid">{buckets.map(({ tier, items }) => <div key={tier} className={`hh-realtor-tier is-${tier}`}>
      <h3>{TIER_META[tier].label}</h3>
      {items.length ? <ul>{items.map((item) => <li key={item.key}>{item.label}{item.detail && <small>{item.detail}</small>}</li>)}</ul> : <p>None selected</p>}
    </div>)}</div>
  </section>;
}

function Stars({ value }) {
  if (!value) return null;
  return <span className="hh-realtor-stars" aria-label={`${value} out of 5 stars`}><Star size={13} fill="currentColor" /> {value}</span>;
}

function HomeCard({ home, people, states, priorities, searchId }) {
  const identity = homeIdentity(home, priorities);
  const match = computeMatch(home, priorities);
  return <article className="hh-realtor-home-card">
    <Link href={`/people/${searchId}/homes/${home.id}`} className="hh-realtor-home-photo">{home.photoUrl ? <img src={home.photoUrl} alt="" /> : <span>Home</span>}</Link>
    <div className="hh-realtor-home-body">
      <div className="hh-realtor-home-heading"><div><strong>{identity.primary}</strong>{identity.supporting && <small>{identity.supporting}</small>}</div>{match?.pct != null && <b style={{ color: matchColor(match.pct) }}>{match.pct}% Match</b>}</div>
      <div className="hh-realtor-price">{formatHomePrice(home.price, priorities.searchType) || 'Price unknown'}</div>
      <div className="hh-realtor-perspectives">{people.map((person) => {
        const state = states.find((candidate) => candidate.user_id === person.user_id);
        if (!state) return <div key={person.user_id}><strong>{person.display_name}</strong><span>No response yet</span></div>;
        return <div key={person.user_id}><strong>{person.display_name}</strong><span>{state.is_favorite && <em><Heart size={12} fill="currentColor" /> Favorite</em>}{state.status === 'Want to Tour' && <em className="tour"><Footprints size={12} /> Want to Tour</em>}{state.reaction && <em>{state.reaction}</em>}<Stars value={state.ratings?.[TOUR_RATING_KEY]} /></span></div>;
      })}</div>
    </div>
  </article>;
}

export default function RealtorWorkspace({ context }) {
  const owner = context.people.find((person) => person.relationship === 'Owner') || context.people[0];
  const ownerPriorities = normalizePriorities(context.priorities.find((row) => row.user_id === owner?.user_id)?.priorities);
  const stateFor = (home) => context.states.filter((state) => state.home_id === home.id);
  const archived = context.homes.filter((home) => {
    const states = stateFor(home);
    return states.length > 0 && states.every((state) => state.status === 'Archived');
  });
  const active = context.homes.filter((home) => !archived.some((candidate) => candidate.id === home.id));
  const tour = active.filter((home) => stateFor(home).some((state) => state.status === 'Want to Tour'));
  const names = context.people.map((person) => person.display_name).join(' & ');
  return <main className="hh-realtor-workspace">
    <header className="hh-realtor-client-header"><Link href="/people">← People I’m Helping</Link><div><span>Client search</span><h1>{names || 'Buyer search'}</h1><p>Understand what matters, where the contenders stand, and where perspectives differ.</p></div><RealtorSuggestHome context={context} /></header>
    <section className="hh-realtor-section"><div className="hh-realtor-section-title"><div><span>Start here</span><h2>What matters to them</h2></div><Users size={21} /></div><div className="hh-realtor-priority-people">{context.people.map((person) => <Priorities key={person.user_id} person={person} priorities={context.priorities.find((row) => row.user_id === person.user_id)?.priorities} />)}</div></section>
    {tour.length > 0 && <section className="hh-realtor-tour-strip"><Footprints size={22} /><div><strong>{tour.length} {tour.length === 1 ? 'home' : 'homes'} marked Want to Tour</strong><span>{tour.map((home) => homeIdentity(home, ownerPriorities).primary).join(' · ')}</span></div></section>}
    <section className="hh-realtor-section"><div className="hh-realtor-section-title"><div><span>Decision context</span><h2>Homes they’re considering</h2></div>{active.length > 1 && <Link className="hh-btn" href={`/people/${context.search.id}/compare`}>Compare contenders</Link>}</div>
      {active.length ? <div className="hh-realtor-home-grid">{active.map((home) => <HomeCard key={home.id} home={home} people={context.people} states={stateFor(home)} priorities={ownerPriorities} searchId={context.search.id} />)}</div> : <div className="hh-realtor-empty">No homes have been added yet. Their priorities are still available above.</div>}
    </section>
    <section className="hh-realtor-section"><div className="hh-realtor-section-title"><div><span>Suggestions</span><h2>Homes I’ve suggested</h2></div></div>
      {context.suggestions.length ? <div className="hh-suggestion-history">{context.suggestions.map((suggestion) => <article key={suggestion.id}><strong>{homeIdentity(suggestion.home, ownerPriorities).primary}</strong><span>{suggestion.status === 'accepted' ? `Added to My Homes${suggestion.promotedBy ? ` by ${context.people.find((person) => person.user_id === suggestion.promotedBy)?.display_name || 'a buyer'}` : ''}` : suggestion.status === 'dismissed' ? 'Dismissed' : 'Pending'}</span>{suggestion.dispositions.map((item) => <small key={item.userId}><b>Dismissed by {context.people.find((person) => person.user_id === item.userId)?.display_name || 'buyer'}</b>{item.reasons.length ? ` · ${item.reasons.join(' · ')}` : ''}{item.otherText ? ` — ${item.otherText}` : ''}</small>)}</article>)}</div> : <p className="hh-muted">No suggestions yet.</p>}
    </section>
    {archived.length > 0 && <section className="hh-realtor-section hh-realtor-archive"><div className="hh-realtor-section-title"><div><span>Ruled out</span><h2><Archive size={18} /> Archived</h2></div></div><div className="hh-realtor-home-grid">{archived.map((home) => <HomeCard key={home.id} home={home} people={context.people} states={stateFor(home)} priorities={ownerPriorities} searchId={context.search.id} />)}</div></section>}
  </main>;
}
