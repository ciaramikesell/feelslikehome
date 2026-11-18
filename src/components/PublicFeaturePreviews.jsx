'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Heart, HousePlus, ListChecks, Users } from 'lucide-react';

const features = [
  { id: 'priorities', Icon: ListChecks, title: 'Set Your Preferences', copy: 'Tell Feels Like Home what matters to you — and how important each priority is in your decision.' },
  { id: 'listings', Icon: HousePlus, title: 'Bring Homes From Anywhere', copy: "Import the listings you're actually considering and keep every contender in one place." },
  { id: 'compare', Icon: Heart, title: 'Compare What Matters', copy: 'Explore how each home fits your personalized criteria, and explore your options side by side.' },
  { id: 'collaborate', Icon: Users, title: 'Search Together', copy: 'Add a co-buyer, invite your Realtor, and make decisions with clarity.' },
];

const previewAlt = {
  priorities: 'Example priorities: home office is Must Have, fenced yard is Important, and soaking tub is Nice to Have.',
  listings: 'Illustrated listing sources and a My Homes shortlist containing three fictional homes.',
  compare: 'Three fictional homes with sample Match scores of 92%, 87%, and 76%. The example breakdown marks five priorities as met and Pool as a mismatch.',
  collaborate: 'Ciara and Andrew see separate priority and commute examples for a shared home, alongside a suggestion from their Realtor Whitney.',
};

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
        <div className="pl-preview-stage">
          <Image src={`/images/homepage-previews/${active}.webp`} alt={previewAlt[active]} fill
            sizes="(max-width: 640px) calc(100vw - 50px), (max-width: 900px) calc(100vw - 76px), 672px" />
        </div>
        <figcaption>Illustrative examples. Navigation and details may differ. Listing sites are shown for reference only, without affiliation or direct integration.</figcaption>
      </figure>
    </section>
  );
}
