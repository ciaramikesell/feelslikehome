'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Heart, HousePlus, ListChecks, Users } from 'lucide-react';

const features = [
  { id: 'priorities', Icon: ListChecks, title: 'Set Your Preferences', copy: 'Tell Feels Like Home what matters to you — and how important each priority is to your decision.' },
  { id: 'listings', Icon: HousePlus, title: 'Import Homes from Anywhere', copy: 'Keep the listings you’ve found in one place, no matter where you discovered them.' },
  { id: 'compare', Icon: Heart, title: 'Compare What Matters', copy: 'See how each home fits your priorities, with your personal Match clearly broken down.' },
  { id: 'collaborate', Icon: Users, title: 'Search & Decide Together', copy: 'Compare your own priorities alongside your co-buyer’s, with suggestions from your Realtor.' },
];

const previewAlt = {
  priorities: 'Example priorities: home office is Must Have, fenced yard is Important, and soaking tub is Nice to Have.',
  listings: 'Illustrated listing sources and a My Homes shortlist containing three fictional homes.',
  compare: 'Three fictional homes with sample Match scores of 92%, 87%, and 76%. The example breakdown marks five priorities as met and Pool as a mismatch.',
  collaborate: 'Illustrated shared home with Ciara’s fenced yard, home office and guest bedroom priorities, and Andrew’s garage, fenced yard and finished basement priorities.',
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
        <h2 className="pl-eyebrow" id="values-title">How it works</h2>
        <p className="pl-values-lead">Import the homes you’ve already saved. See how they match what matters to you. Then tour, compare, and choose together.</p>
      </header>
      <ul className="pl-value-grid" aria-label="Feature previews">
        {features.map(({ id, Icon, title }) => (
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
              <span className="pl-feature-text"><strong>{title}</strong></span>
            </button>
          </li>
        ))}
      </ul>
      <figure className="pl-feature-preview" id="pl-feature-preview" aria-label={current.title}>
        <span className="sr-only" role="status">{current.title} preview</span>
        <div className="pl-preview-stage">
          <Image src={`/images/homepage-previews/${active}.webp`} alt={previewAlt[active]} fill
            loading="lazy" sizes="(max-width: 640px) calc(100vw - 50px), (max-width: 900px) calc(100vw - 76px), 640px" />
        </div>
        <figcaption>{features.map(({ id, copy }) => <p key={id} aria-hidden={active !== id}>{copy}</p>)}</figcaption>
      </figure>
      <p className="pl-illustration-note">Illustrative mockups. Listing-source names do not imply affiliation or direct integration.</p>
    </section>
  );
}
