'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, House, MapPin, Plus, Sparkles } from 'lucide-react';
import Sheet from '@/components/Sheet';
import BasicsEditor from '@/components/BasicsEditor';
import CoBuyerManagement from '@/components/CoBuyerManagement';
import InviteCoBuyer from '@/components/InviteCoBuyer';
import {
  Avatar, Chevron, IconBadge, LevelDot, MobilePage, PageHeading, SaveStatus, SectionCard, SectionLabel,
} from '@/components/MobileSystem';
import { normalizePriorities, getItemlistCategories } from '@/lib/constants';
import {
  basicsSummary, matchShapingPriorityCount, placesSummary, priorityLevels, searchStatusCopy,
} from '@/lib/searchProfile';
import { createClient } from '@/lib/supabase/client';
import { useReliableOptimisticState } from '@/lib/useReliableOptimisticState';
import { savePriorities } from '@/lib/supabase/collaboration';

// My Search is a personal search profile: an overview you can read at a glance,
// with each part opening its own focused editor. "Onboarding teaches me how to
// build my search. My Search lets me understand and maintain the search I built."

function WhatMattersMost({ levels }) {
  const total = levels.reduce((sum, level) => sum + level.items.length, 0);
  return (
    <SectionCard href="/search/priorities" className="flh-priorities-summary" ariaLabel={`What matters most: ${total} ${total === 1 ? 'priority' : 'priorities'}. Rank priorities`}>
      <SectionLabel as="h2" meta={`${total} ${total === 1 ? 'priority' : 'priorities'}`}>What matters most</SectionLabel>
      {total ? (
        <ul className="flh-level-summary">
          {levels.map((level) => (
            <li key={level.tier}>
              <LevelDot tier={level.tier} />
              <div>
                <p className={`flh-level-name flh-level-text-${level.tier}`}>{level.label} <span>{level.items.length}</span></p>
                <p className="flh-level-items">{level.items.length ? level.items.map((item) => item.qualifier ? `${item.displayLabel} (${item.qualifier})` : item.displayLabel).join(' · ') : 'Nothing here yet'}</p>
              </div>
              <Chevron />
            </li>
          ))}
        </ul>
      ) : (
        <p className="flh-card-empty">Nothing ranked yet. Add what matters to you and your homes will start to measure up. <Chevron /></p>
      )}
    </SectionCard>
  );
}

function WhatImLookingFor({ priorities, onEdit }) {
  const summary = basicsSummary(priorities);
  return (
    <SectionCard onClick={onEdit} className="flh-basics-summary" ariaLabel="What I’m looking for. Edit">
      <div className="flh-card-row">
        <IconBadge icon={House} />
        <div className="flh-card-heading">
          <h2 className="flh-card-title">What I’m Looking For</h2>
          <p className="flh-card-sub">{summary.experienceLabel ? `${summary.experienceLabel} · ` : ''}<span className="flh-link-text">Edit</span></p>
        </div>
        <span className="flh-card-meta">{summary.setCount} set</span>
        <Chevron />
      </div>
      {summary.setCount ? (
        <div className="flh-basics-lines">
          {summary.numbers.length > 0 && <p>{summary.numbers.join(' · ')}</p>}
          {summary.details.map((detail) => <p key={detail.key}><span>{detail.label}:</span> {detail.values.join(' · ')}</p>)}
        </div>
      ) : (
        <p className="flh-card-empty">Add a budget, size, or the kinds of homes you’re considering.</p>
      )}
    </SectionCard>
  );
}

function PlacesThatMatter({ destinations }) {
  const summary = placesSummary(destinations);
  return (
    <SectionCard tone="sage" href="/search/places" className="flh-places-summary" ariaLabel={`Places that matter: ${summary.countLabel}. Edit places`}>
      <div className="flh-card-row">
        <IconBadge icon={MapPin} tone="sage" />
        <div className="flh-card-heading">
          <h2 className="flh-card-title">Places that matter</h2>
          <p className="flh-card-sub">{summary.count ? `${summary.names} · ${summary.countLabel}` : 'Add work, family, school—anywhere you go often.'}</p>
        </div>
        {summary.count > 0 && <span className="flh-card-meta">{summary.countLabel}</span>}
        <Chevron />
      </div>
    </SectionCard>
  );
}

// A compact count summary of the collaborator's own perspective — never their
// itemized priorities or places, and never blended with yours. There is
// intentionally no "View {name}'s Criteria" link: a co-buyer has
// no dedicated read-only route to another participant's criteria today, and
// inventing one would be a new data path, not a presentation change.
function CollaboratorSummary({ context }) {
  if (!context) return null;
  const name = context.displayName || 'Your collaborator';
  const priorities = normalizePriorities(context.priorities);
  const boardItems = getItemlistCategories(priorities.searchType).flatMap((category) =>
    Object.values(priorities[category.key]?.tiers || {}).filter((tier) => tier && tier !== 'dontcare').map((tier) => ({ tier })));
  const structured = [
    priorities.budget, priorities.bedsMin, priorities.bathsMin, priorities.sqftTarget,
    priorities.lotSizeTarget, priorities.preferredPropertyTypes, priorities.homeLayout, priorities.homeCondition,
  ].filter((value) => value?.tier && value.tier !== 'dontcare' && (value.value || value.values?.length)).map((value) => ({ tier: value.tier }));
  const items = [...structured, ...boardItems];
  const countOf = (tier) => items.filter((item) => item.tier === tier).length;
  const places = context.commuteDestinations || [];
  return items.length ? (
    <div className="hh-collaborator-summary">
      <div><strong>{name}&apos;s priorities</strong><span>{countOf('must')} Must {countOf('must') === 1 ? 'Have' : 'Haves'} · {countOf('important')} Important · {countOf('nice')} Nice to {countOf('nice') === 1 ? 'Have' : 'Haves'}</span></div>
      <div><strong>{name}&apos;s places</strong><span>{places.length ? `${places.length} place${places.length === 1 ? '' : 's'} that matter` : 'No places added yet'}</span></div>
    </div>
  ) : <p className="hh-detail-context">{name} hasn&apos;t added priorities yet.</p>;
}

// "The house is ours. The opinion is mine. The conversation is shared." Each
// participant keeps their own Match and priorities; nothing is combined.
function SearchingTogether({ search, userId, isOwner, participantCount, memberUserId, collaboratorContext }) {
  const [open, setOpen] = useState(false);
  const collaborative = participantCount > 1;
  const name = collaboratorContext?.displayName || 'your co-buyer';
  if (!collaborative && !isOwner) return null;
  return (
    <>
      <SectionCard tone="warm" onClick={() => setOpen(true)} className="flh-together-summary" ariaLabel={collaborative ? `Searching with ${name}. Manage` : 'Searching together. Invite a co-buyer or Realtor'}>
        <div className="flh-card-row">
          {collaborative
            ? <span className="flh-avatar-stack"><Avatar name="You" /><Avatar name={collaboratorContext?.displayName} tone="sage" /></span>
            : <IconBadge icon={Plus} />}
          <div className="flh-card-heading">
            <h2 className="flh-card-title">{collaborative ? `Searching with ${collaboratorContext?.displayName || 'a co-buyer'}` : 'Searching Together'}</h2>
            <p className="flh-card-sub">{collaborative ? 'Both perspectives shape every Match.' : <>You’re searching alone. <span className="flh-link-text">Invite a co-buyer or Realtor →</span></>}</p>
          </div>
          <Chevron />
        </div>
      </SectionCard>
      {open && collaborative && (
        <Sheet open onClose={() => setOpen(false)} title="Searching together" size="default">
          <p className="flh-sheet-lead">The house is ours. The opinion is mine. The conversation is shared. Each of you keeps your own priorities and your own Match.</p>
          <CollaboratorSummary context={collaboratorContext} />
          <div style={{ marginTop: 16 }}>
            <CoBuyerManagement userId={userId} search={search} isOwner={isOwner} participantCount={participantCount} memberUserId={memberUserId} collaboratorName={collaboratorContext?.displayName} />
          </div>
        </Sheet>
      )}
      {open && !collaborative && <InviteCoBuyer searchId={search.id} userId={userId} embedded onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchStatus({ count, firstRun }) {
  const copy = searchStatusCopy({ count, firstRun });
  return (
    <Link href={firstRun ? '/homes?add=1' : '/homes'} className="flh-card flh-card-quiet is-interactive flh-status-card">
      <div className="flh-card-row">
        <IconBadge icon={Sparkles} tone="sage" />
        <div className="flh-card-heading">
          <p className="flh-card-title flh-card-title-small">{copy.title}</p>
          <p className="flh-card-sub">{copy.body}</p>
        </div>
        <ArrowRight size={18} className="flh-chevron" aria-hidden="true" />
      </div>
    </Link>
  );
}

export default function MySearchPanel({ search, userId, isOwner, participantCount, memberUserId, initialPriorities, initialCommuteDestinations, collaboratorContext = null, firstRun = false }) {
  const persistPriorities = useCallback((next) => savePriorities(createClient(), search, userId, next), [search, userId]);
  const { state: priorities, patch, saveError, retry, isSaving } = useReliableOptimisticState(normalizePriorities(initialPriorities), persistPriorities);
  const [basicsOpen, setBasicsOpen] = useState(false);
  const levels = priorityLevels(priorities);
  const destinations = initialCommuteDestinations || [];

  return (
    <MobilePage className="flh-my-search">
      <PageHeading title="My Search" subtitle="The things that make a place feel like home" aside={<SaveStatus saving={isSaving} error={saveError} />} />
      {saveError && <p className="hh-save-error" role="alert">{saveError} <button type="button" onClick={retry}>Retry</button></p>}
      <div className="flh-my-search-grid">
        <div className="flh-my-search-primary">
          <WhatMattersMost levels={levels} />
        </div>
        <div className="flh-my-search-rail">
          <WhatImLookingFor priorities={priorities} onEdit={() => setBasicsOpen(true)} />
          <PlacesThatMatter destinations={destinations} />
          <SearchingTogether search={search} userId={userId} isOwner={isOwner} participantCount={participantCount} memberUserId={memberUserId} collaboratorContext={collaboratorContext} />
          <SearchStatus count={matchShapingPriorityCount(priorities)} firstRun={firstRun} />
        </div>
      </div>
      <Sheet open={basicsOpen} onClose={() => setBasicsOpen(false)} title="What I’m looking for" size="large">
        <BasicsEditor priorities={priorities} patch={patch} />
        <div className="flh-sheet-actions"><button type="button" className="flh-button flh-button-primary" onClick={() => setBasicsOpen(false)}>Done</button></div>
      </Sheet>
    </MobilePage>
  );
}
