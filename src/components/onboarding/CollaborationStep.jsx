'use client';

import { useId, useState } from 'react';
import { Check, ChevronDown, Copy, Home, Plus, Users } from 'lucide-react';
import { OnboardingAction } from '@/components/onboarding/OnboardingShell';
import { findOpenInvite, hasRelationship, inviteProblem, pendingFor, selectionFromChoice } from '@/lib/onboardingPeople';

// Step 3 of Onboarding V2: "Searching with someone?" (approved Figma design).
//
// Choosing a card records an intention only (the onboarding answer). Nothing
// is sent, and no access is granted, until the owner explicitly creates an
// invite link — the same search_invitations link My Search creates, which the
// owner shares themselves. Existing members and open invites are shown as they
// are, so returning here never misrepresents who is in the search.

const KINDS = {
  co_buyer: {
    title: 'A co-buyer',
    description: 'Searching with a partner or someone making the decision with you? You’ll each have your own priorities, all in one shared search.',
    Icon: Users,
    label: 'co-buyer',
  },
  realtor: {
    title: 'A Realtor',
    description: 'Working with an agent? They can follow your search, see what matters to you, and suggest homes worth a look.',
    Icon: Home,
    label: 'Realtor',
  },
};

const formatDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
};

function inviteLink(token) {
  return typeof window === 'undefined' ? `/invite/${token}` : `${window.location.origin}/invite/${token}`;
}

function CopyLink({ token, email }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link stays visible and selectable either way.
    }
  };
  return (
    <span className="flh-ob-invite-link">
      <input readOnly value={link} aria-label={`Invite link for ${email}`} onFocus={(event) => event.target.select()} />
      <button type="button" className="flh-button flh-button-outline flh-button-small" onClick={copy}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span>{copied ? 'Copied' : 'Copy link'}</span>
      </button>
    </span>
  );
}

// What already exists for this relationship: joined people and open invites.
function CardStatus({ kind, people }) {
  const joined = hasRelationship(people, kind);
  const pending = pendingFor(people, kind);
  if (joined) {
    const name = kind === 'co_buyer' ? people.coBuyers[0]?.name : null;
    return <span className="flh-ob-person-status is-joined">{kind === 'co_buyer' ? `Joined${name ? ` · ${name}` : ''}` : 'Connected'}</span>;
  }
  if (pending.length) return <span className="flh-ob-person-status is-pending">{pending.length === 1 ? 'Invite link created' : `${pending.length} invite links created`}</span>;
  return null;
}

function InvitePanel({ kind, people, role, accountEmail, onInvite }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const { label } = KINDS[kind];
  const pending = pendingFor(people, kind);

  // Only the search owner manages invitations (existing roles).
  if (role !== 'owner') {
    return (
      <div className="flh-ob-invite">
        <p className="flh-ob-invite-note">Only {people.ownerName || 'the search owner'} can invite a {label} to this search—let them know you’d like one.</p>
      </div>
    );
  }

  if (kind === 'co_buyer' && hasRelationship(people, 'co_buyer')) {
    return (
      <div className="flh-ob-invite">
        <p className="flh-ob-invite-note">{people.coBuyers[0]?.name || 'Your co-buyer'} is already searching with you. You can manage people in My Search.</p>
      </div>
    );
  }

  const create = async (event) => {
    event.preventDefault();
    const issue = inviteProblem(email, { accountEmail });
    setProblem(issue || '');
    setNotice('');
    if (issue) return;
    const existing = findOpenInvite(people, kind, email);
    if (existing) {
      setNotice(`You already created an invite link for ${existing.email}. It’s below—nothing new was created.`);
      setEmail('');
      return;
    }
    setCreating(true);
    try {
      const invite = await onInvite(kind, email);
      setNotice(invite.reused
        ? `You already had an open invite link for ${invite.email}. It’s below—nothing new was created.`
        : `Invite link created for ${invite.email}. Nothing has been sent—copy the link and share it with them.`);
      setEmail('');
    } catch {
      setProblem('Couldn’t create the invite link. Nothing was sent. Try again, or invite them later from My Search.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flh-ob-invite">
      {kind === 'realtor' && hasRelationship(people, 'realtor') && (
        <p className="flh-ob-invite-note">A Realtor is already connected to this search.</p>
      )}
      {pending.length > 0 && (
        <ul className="flh-ob-invite-list" aria-label={`Open ${label} invites`}>
          {pending.map((invite) => (
            <li key={invite.id}>
              <span className="flh-ob-invite-who">
                <strong>{invite.email}</strong>
                <span>Invite link created · not accepted yet · expires {formatDate(invite.expiresAt)}</span>
              </span>
              <CopyLink token={invite.token} email={invite.email} />
            </li>
          ))}
        </ul>
      )}
      <form className="flh-ob-invite-form" onSubmit={create} noValidate>
        <label className="flh-ob-sublabel" htmlFor={id}>{pending.length ? `Invite another ${label}` : `Invite your ${label}`} <span className="flh-ob-optional-tag">Optional</span></label>
        <span className="flh-ob-invite-row">
          <span className="flh-ob-input">
            <input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="their@email.com"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setProblem(''); }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-help${problem ? ` ${id}-problem` : ''}`}
            />
          </span>
          <button type="submit" className="flh-button flh-button-outline flh-ob-invite-create" disabled={creating || !email.trim()}>{creating ? 'Creating…' : 'Create invite link'}</button>
        </span>
        {problem && <p id={`${id}-problem`} className="flh-field-error" role="alert">{problem}</p>}
        <p id={`${id}-help`} className="flh-ob-help">Nothing is sent. You’ll get a link to share with them yourself; it expires in 7 days and gives access only after they sign in and accept.</p>
      </form>
      {notice && <p className="flh-ob-invite-notice" role="status">{notice}</p>}
    </div>
  );
}

function PersonCard({ kind, selected, locked, lockedNote, onToggle, people, role, accountEmail, onInvite }) {
  const { title, description, Icon } = KINDS[kind];
  const panelId = useId();
  return (
    <section className={`flh-ob-person${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="flh-ob-person-toggle"
        aria-pressed={selected}
        aria-controls={selected ? panelId : undefined}
        aria-disabled={locked || undefined}
        onClick={locked ? undefined : onToggle}
      >
        <span className="flh-ob-person-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
        <span className="flh-ob-person-copy">
          <span className="flh-ob-person-title">{title}</span>
          <span className="flh-ob-person-desc">{description}</span>
          {locked && lockedNote ? <span className="flh-ob-person-status is-joined">{lockedNote}</span> : <CardStatus kind={kind} people={people} />}
        </span>
        <span className="flh-ob-person-check" aria-hidden="true">{selected ? <Check size={16} strokeWidth={2.6} /> : <Plus size={16} strokeWidth={2.2} />}</span>
      </button>
      {selected && !locked && (
        <div id={panelId}>
          <InvitePanel kind={kind} people={people} role={role} accountEmail={accountEmail} onInvite={onInvite} />
        </div>
      )}
    </section>
  );
}

function SharingInfo() {
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
          <li><strong>Co-buyers</strong> share the same search but keep their own priorities, Match and ratings. Nobody can change anyone else’s.</li>
          <li><strong>A Realtor</strong> can see your search and what matters to you, and suggest homes. They can’t change your priorities, ratings or search settings.</li>
          <li><strong>Invites are links you share yourself.</strong> Choosing a card here doesn’t send anything. A link expires in 7 days and gives access only after the person signs in and accepts.</li>
          <li>You can invite people later, or manage who’s in your search, from My Search.</li>
        </ul>
      </div>
    </div>
  );
}

export default function CollaborationStep({ header, choice, onChoose, people, peopleError, role, accountEmail, onInvite, onNext, onMaybeLater }) {
  const selection = selectionFromChoice(choice);
  const isCoBuyer = role === 'co_buyer';
  const anySelected = selection.co_buyer || selection.realtor;
  const toggle = (kind) => onChoose({ ...selection, [kind]: !selection[kind] });
  return (
    <div className="flh-onboarding-step flh-ob-people">
      {header}
      {peopleError && <p className="flh-field-error" role="alert">{peopleError}</p>}
      <div className="flh-ob-people-cards">
        <PersonCard
          kind="co_buyer"
          selected={selection.co_buyer || isCoBuyer}
          locked={isCoBuyer}
          lockedNote={isCoBuyer ? `You’re searching with ${people.ownerName || 'the search owner'}` : null}
          onToggle={() => toggle('co_buyer')}
          people={people}
          role={role}
          accountEmail={accountEmail}
          onInvite={onInvite}
        />
        <PersonCard kind="realtor" selected={selection.realtor} onToggle={() => toggle('realtor')} people={people} role={role} accountEmail={accountEmail} onInvite={onInvite} />
      </div>
      <SharingInfo />
      <p className="flh-ob-people-note">
        {anySelected && !isCoBuyer
          ? 'Choosing someone here doesn’t invite them. Create an invite link only when you’re ready—or later from My Search.'
          : 'No invitations now—you can bring someone in whenever you’re ready.'}
      </p>
      <nav className="flh-onboarding-actions flh-ob-people-actions" aria-label="Step actions">
        <button type="button" className="flh-text-action flh-ob-later" onClick={onMaybeLater}>Maybe later</button>
        <OnboardingAction onClick={onNext}>Continue</OnboardingAction>
      </nav>
    </div>
  );
}
