'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ArrowDown, Check, Heart, HousePlus, ListChecks, MessageSquareText, Users } from 'lucide-react';
import { BrandMark } from '@/components/ui';

const features = [
  { id: 'priorities', Icon: ListChecks, title: 'Set Your Preferences', copy: 'Tell Feels Like Home what matters to you — and how important each priority is in your decision.' },
  { id: 'listings', Icon: HousePlus, title: 'Bring Homes From Anywhere', copy: "Import the listings you're actually considering and keep every contender in one place." },
  { id: 'compare', Icon: Heart, title: 'Compare What Matters', copy: 'Explore how each home fits your personalized criteria, and explore your options side by side.' },
  { id: 'collaborate', Icon: Users, title: 'Search Together', copy: 'Add a co-buyer, invite your Realtor, and make decisions with clarity.' },
];

const priorityCards = [
  { title: 'Home office', photo: 'home-office', level: 'Must Have', tier: 'must' },
  { title: 'Fenced yard', photo: 'fenced-yard', level: 'Important', tier: 'important' },
  { title: 'Soaking tub', photo: 'soaking-tub', level: 'Nice to Have', tier: 'nice' },
];

const listings = [
  { source: 'Zillow', address: '18 Linden Lane', photo: 'front-porch' },
  { source: 'Redfin', address: '42 Maple Court', photo: 'mature-trees' },
  { source: 'Realtor.com', address: '9 Willow Drive', photo: 'garden-space' },
];

function PreviewPhoto({ name }) {
  // The card's text identifies the fictional example. These photos are decorative.
  return <div className="pl-preview-photo"><Image src={`/images/onboarding/${name}.webp`} alt="" fill sizes="(max-width: 640px) 30vw, 210px" /></div>;
}

function PreviewContent({ id }) {
  switch (id) {
    case 'listings':
      return <div className="pl-preview-composition pl-preview-import">
        <ul className="pl-preview-cards">
          {listings.map(({ source, address, photo }) => <li key={source}>
            <span className="pl-preview-source">{source}</span><PreviewPhoto name={photo} /><strong>{address}</strong>
          </li>)}
        </ul>
        <div className="pl-preview-destination">
          <ArrowDown aria-hidden="true" size={17} /><BrandMark size={24} /><strong>My Homes</strong>
        </div>
      </div>;
    case 'compare':
      return <Image className="pl-preview-match" src="/images/FLH Example.png" alt="Illustrated comparison with three homes, sample Match scores of 92%, 87%, and 76%, and a personal breakdown marking five priorities as met and Pool as a mismatch." fill sizes="(max-width: 900px) 100vw, 650px" />;
    case 'collaborate':
      return <div className="pl-preview-composition pl-preview-shared">
        <div className="pl-preview-shared-home"><PreviewPhoto name="front-porch" /><strong>18 Linden Lane</strong><span>Shared search</span></div>
        <div className="pl-preview-buyers">
          <div><strong>Ciara</strong><span><Check size={14} aria-hidden="true" /> Fenced yard</span></div>
          <div><strong>Andrew</strong><span><Check size={14} aria-hidden="true" /> Garage</span></div>
        </div>
        <div className="pl-preview-suggestion"><MessageSquareText size={17} aria-hidden="true" /><div><strong>Whitney · Realtor suggestion</strong><span>Take a look at the flex room.</span></div></div>
      </div>;
    default:
      return <div className="pl-preview-composition pl-preview-priorities">
        <h3>What matters most to you?</h3>
        <ul className="pl-preview-cards">
          {priorityCards.map(({ title, photo, level, tier }) => <li key={title}>
            <PreviewPhoto name={photo} /><strong>{title}</strong><span className="pl-preview-tier" data-tier={tier}>{level}</span>
          </li>)}
        </ul>
      </div>;
  }
}

export default function PublicFeaturePreviews() {
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const active = selected ?? hovered ?? focused ?? features[0].id;
  const current = features.find(feature => feature.id === active);

  return (
    <section className="pl-values" id="how-it-works" aria-labelledby="values-title" tabIndex={-1}>
      <header className="pl-values-intro">
        <p className="pl-eyebrow">How it works</p>
        <h2 className="pl-values-lead" id="values-title">Search anywhere.<br />Decide here.</h2>
      </header>
      <ul className="pl-value-grid" aria-label="Feature previews">
        {features.map(({ id, Icon, title, copy }) => (
          <li key={id}>
            <button
              type="button"
              className="pl-feature-button"
              aria-pressed={active === id}
              aria-controls="pl-feature-preview"
              onFocus={() => {
                if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                  setHovered(null);
                  setFocused(id);
                }
              }}
              onBlur={() => setFocused(null)}
              onPointerEnter={event => {
                if (event.pointerType === 'mouse') setHovered(id);
              }}
              onPointerLeave={() => setHovered(null)}
              onClick={() => setSelected(id)}
            >
              <span className="pl-step-icon"><Icon size={21} strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="pl-feature-text"><strong>{title}</strong><span>{copy}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <figure className="pl-feature-preview" id="pl-feature-preview" aria-label={current.title}>
        <div className="pl-mobile-feature-copy">
          {features.map(({ id, copy }) => <p key={id} aria-hidden={active !== id}>{copy}</p>)}
        </div>
        <span className="sr-only" role="status">{current.title} preview</span>
        <div className="pl-preview-stage"><PreviewContent id={active} /></div>
        <figcaption>Illustrative examples</figcaption>
      </figure>
    </section>
  );
}
