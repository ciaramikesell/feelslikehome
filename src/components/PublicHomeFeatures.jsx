'use client';

import { useEffect, useRef, useState } from 'react';
import PublicFeatureArtwork from '@/components/PublicFeatureArtwork';
import { ensureNativeShellFlag, isNativeApp, NATIVE_SHELL_ATTRIBUTE } from '@/lib/platform';

// One substantial product story: four human-readable steps (WAI-ARIA tabs) and
// a large stage that changes with them. Nothing advances on its own.
export const features = [
  {
    id: 'priorities', short: 'Priorities', title: 'Rank what matters',
    copy: 'Pick the features you care about, then decide how much each one matters to you.',
    alt: 'Illustrated priorities: Home Office is Must Have, Fenced Yard is Important, and Soaking Tub is Nice to Have.',
  },
  {
    id: 'listings', short: 'Save', title: 'Save homes from anywhere',
    copy: 'Paste a listing link from any site and keep every contender in one place.',
    alt: 'Illustrative listing-source labels leading into a saved collection of three homes.',
  },
  {
    id: 'compare', short: 'Match', title: 'See your personal Match',
    copy: 'Each home is measured against your priorities. Facts that aren’t listed yet stay unknown, because unknown isn’t no.',
    alt: 'Three fictional homes with illustrative 92%, 87%, and 76% Match badges.',
  },
  {
    id: 'collaborate', short: 'Together', title: 'Decide together',
    copy: 'Invite a co-buyer or your Realtor. Everyone keeps their own priorities and their own Match.',
    alt: 'Separate fictional Match results for Ciara and Andrew. Ciara’s Location, Home Office and Garage hearts are filled. Andrew’s Garage and Home Office hearts are filled; Finished Basement is outlined.',
  },
];

export default function PublicHomeFeatures() {
  const [webShowcase, setWebShowcase] = useState(false);
  const [active, setActive] = useState(0);
  const tabRefs = useRef([]);
  const swipeRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      // The installed app loads this website remotely. Bridge detection and
      // its first-paint flag, never viewport width, decide native exclusion.
      ensureNativeShellFlag();
      setWebShowcase(!isNativeApp() && !root.hasAttribute(NATIVE_SHELL_ATTRIBUTE));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: [NATIVE_SHELL_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);

  const goTo = (index, { focus = false } = {}) => {
    if (!webShowcase || isNativeApp() || document.documentElement.hasAttribute(NATIVE_SHELL_ATTRIBUTE)) return;
    const target = (index + features.length) % features.length;
    setActive(target);
    if (focus) tabRefs.current[target]?.focus();
  };

  const onTabKeyDown = event => {
    const target = {
      ArrowLeft: active - 1, ArrowUp: active - 1, ArrowRight: active + 1, ArrowDown: active + 1,
      Home: 0, End: features.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    goTo(target, { focus: true });
  };

  // Horizontal swipe on the stage is a touch shortcut for the same tabs.
  const onPointerDown = event => {
    if (event.pointerType === 'mouse') return;
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = event => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) goTo(active + (dx < 0 ? 1 : -1));
  };

  return <section className="pl-how" id="how-it-works" aria-labelledby="how-title" tabIndex={-1}>
    <noscript><style>{`.pl-steps{display:none}.pl-stage-panel[hidden]{display:block}.pl-stage-panel{margin-bottom:28px}.pl-stage-detail{display:block!important}`}</style></noscript>
    <div className="pl-how-inner">
      <header className="pl-how-header">
        <p className="pl-eyebrow">How it works</p>
        <h2 id="how-title">From a pile of saved listings to <em>a clear favorite.</em></h2>
      </header>

      <div className="pl-showcase" data-step={features[active].id} data-web-showcase={webShowcase ? 'true' : undefined}>
        <div className="pl-steps" role="tablist" aria-label="How Feels Like Home works">
          {features.map(({ id, short, title, copy }, index) => <button key={id} type="button" role="tab"
            ref={node => { tabRefs.current[index] = node; }}
            id={`pl-step-tab-${id}`} aria-controls={`pl-step-panel-${id}`} aria-selected={active === index}
            tabIndex={active === index ? 0 : -1} className="pl-step" onClick={() => goTo(index)} onKeyDown={onTabKeyDown}>
            <span className="pl-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="pl-step-text">
              <span className="pl-step-title">{title}</span>
              <span className="pl-step-short" aria-hidden="true">{short}</span>
              <span className="pl-step-copy">{copy}</span>
            </span>
          </button>)}
        </div>

        <div className="pl-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeRef.current = null; }}>
          {features.map(({ id, title, copy, alt }, index) => <div key={id} className="pl-stage-panel" role="tabpanel"
            id={`pl-step-panel-${id}`} aria-labelledby={`pl-step-tab-${id}`} hidden={active !== index}>
            <div className="pl-stage-art"><PublicFeatureArtwork id={id} alt={alt} /></div>
            <div className="pl-stage-detail">
              <p className="pl-stage-count" aria-hidden="true">Step {index + 1} of {features.length}</p>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          </div>)}
        </div>
      </div>

      <p className="pl-illustration-note">Illustrative mockups and Match results. Listing-source names do not imply affiliation or direct integration.</p>
    </div>
  </section>;
}
