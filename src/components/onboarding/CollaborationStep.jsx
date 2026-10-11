'use client';

import { useId, useState } from 'react';
import { Check, ChevronDown, Home, Plus, Users } from 'lucide-react';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import { hasRelationship, peopleWords, selectionFromChoice } from '@/lib/onboardingPeople';

// Step 3 of Onboarding V2: "Searching with someone?" (approved Figma design).
//
// The cards capture intent only: choosing one saves the onboarding answer and
// never creates an invitation or a membership. Inviting and managing people
// happens in My Search. People already in the search are shown as they are
// (and their card can't be unchosen here); nobody is ever invented.

// Renters see "Co-renter" and "Agent" (peopleWords); the roles are the same.
const kinds = (words) => ({
  co_buyer: { title: words.coBuyer, description: words.coBuyerDescription, Icon: Users },
  realtor: { title: words.realtor, description: words.realtorDescription, Icon: Home },
});

function PersonCard({ kind, words, selected, relationship, onToggle }) {
  const { title, description, Icon } = kinds(words)[kind];
  const fixed = Boolean(relationship);
  return (
    <button
      type="button"
      className={`flh-ob-person${selected ? ' is-selected' : ''}${fixed ? ' is-fixed' : ''}`}
      aria-pressed={selected}
      aria-disabled={fixed || undefined}
      onClick={fixed ? undefined : onToggle}
    >
      <span className="flh-ob-person-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
      <span className="flh-ob-person-copy">
        <span className="flh-ob-person-title">{title}</span>
        <span className="flh-ob-person-desc">{description}</span>
        {relationship && <span className="flh-ob-person-status">{relationship}</span>}
      </span>
      <span className="flh-ob-person-check" aria-hidden="true">{selected ? <Check size={16} strokeWidth={2.6} /> : <Plus size={16} strokeWidth={2.2} />}</span>
    </button>
  );
}

function SharingInfo({ words }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`flh-ob-sharing${open ? ' is-open' : ''}`}>
      <button type="button" className="flh-ob-sharing-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>
          <span className="flh-ob-sharing-title">How sharing works</span>
          <span className="flh-ob-sharing-summary">Your search stays personal</span>
        </span>
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <div id={id} className="flh-ob-sharing-panel" hidden={!open}>
        <ul>
          <li><strong>{words.coBuyers}</strong> {words.coBuyerSharing}</li>
          <li><strong>{words.realtors}</strong> {words.realtorSharing}</li>
          <li><strong>Invitations</strong> can be sent later from My Search.</li>
        </ul>
      </div>
    </div>
  );
}

// role: 'owner' for someone's own search; 'co_buyer' for someone joining
// another person's search (their co-buyer relationship is already real).
export default function CollaborationStep({ header, choice, onChoose, people, peopleError, role, searchType = null, onNext, onMaybeLater }) {
  const words = peopleWords(searchType);
  const selection = selectionFromChoice(choice);
  const coBuyerName = role === 'co_buyer' ? people.ownerName : people.coBuyers[0]?.name;
  const relationships = {
    co_buyer: role === 'co_buyer' || hasRelationship(people, 'co_buyer')
      ? (coBuyerName ? `You’re searching with ${coBuyerName}` : `You’re searching with a ${words.coBuyerLower}`)
      : null,
    realtor: role === 'owner' && hasRelationship(people, 'realtor') ? `Your ${words.realtorLower} is connected` : null,
  };
  // The saved answer keeps people who are already in the search.
  const toggle = (kind) => onChoose({
    co_buyer: Boolean(relationships.co_buyer) || (kind === 'co_buyer' ? !selection.co_buyer : selection.co_buyer),
    realtor: Boolean(relationships.realtor) || (kind === 'realtor' ? !selection.realtor : selection.realtor),
  });
  return (
    <div className="flh-onboarding-step flh-ob-people">
      {header}
      {peopleError && <p className="flh-field-error" role="alert">{peopleError}</p>}
      <div className="flh-ob-people-cards">
        {['co_buyer', 'realtor'].map((kind) => (
          <PersonCard
            key={kind}
            kind={kind}
            words={words}
            selected={selection[kind] || Boolean(relationships[kind])}
            relationship={relationships[kind]}
            onToggle={() => toggle(kind)}
          />
        ))}
      </div>
      <SharingInfo words={words} />
      <p className="flh-ob-people-note">No invitations now—you can bring someone in whenever you’re ready.</p>
      <nav className="flh-onboarding-actions flh-ob-people-actions" aria-label="Step actions">
        <button type="button" className="flh-text-action flh-ob-later" onClick={onMaybeLater}>Maybe later</button>
        <OnboardingAction onClick={onNext}>Continue</OnboardingAction>
      </nav>
    </div>
  );
}
