'use client';

import Image from 'next/image';
import PublicFeatureArtwork from '@/components/PublicFeatureArtwork';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ensureNativeShellFlag, isNativeApp, NATIVE_SHELL_ATTRIBUTE } from '@/lib/platform';

const features = [
  {
    id: 'priorities', title: 'Set Your Preferences', copy: 'Decide what matters most to you.',
    alt: 'Illustrated priorities: Home Office is Must Have, Fenced Yard is Important, and Soaking Tub is Nice to Have.',
  },
  {
    id: 'listings', title: 'Import Homes from Anywhere', copy: 'Bring your saved listings together.',
    alt: 'Illustrative listing-source labels leading into a saved collection of three homes.',
  },
  {
    id: 'compare', title: 'Compare What Matters', copy: 'See how each home fits your priorities.',
    alt: 'Three fictional homes with illustrative 92%, 87%, and 76% Match badges.',
  },
  {
    id: 'collaborate', title: 'Search & Decide Together', copy: 'Make decisions with your co-buyer and Realtor.',
    alt: 'Separate fictional Match results for Ciara and Andrew. Ciara’s Location, Home Office and Garage hearts are filled. Andrew’s Garage and Home Office hearts are filled; Finished Basement is outlined.',
  },
];

export default function PublicHomeFeatures() {
  const [webShowcase, setWebShowcase] = useState(false);
  const [active, setActive] = useState(0);
  const trackRef = useRef(null);
  const activeRef = useRef(0);
  const widthRef = useRef(0);

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

  useEffect(() => {
    if (!webShowcase) return;
    setActive(0);
    activeRef.current = 0;
    const track = trackRef.current;
    widthRef.current = track.clientWidth;
    track.scrollTo({ left: 0, behavior: 'auto' });
    const resize = new ResizeObserver(() => {
      if (track.clientWidth === widthRef.current) return;
      widthRef.current = track.clientWidth;
      track.scrollTo({ left: track.children[activeRef.current].offsetLeft - track.children[0].offsetLeft, behavior: 'auto' });
    });
    resize.observe(track);
    return () => resize.disconnect();
  }, [webShowcase]);

  const goTo = index => {
    if (!webShowcase || isNativeApp() || document.documentElement.hasAttribute(NATIVE_SHELL_ATTRIBUTE)) return;
    const track = trackRef.current;
    const target = Math.max(0, Math.min(features.length - 1, index));
    track.scrollTo({ left: track.children[target].offsetLeft - track.children[0].offsetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const onScroll = () => {
    if (!webShowcase) return;
    const track = trackRef.current;
    if (track.clientWidth !== widthRef.current) return;
    const step = track.children[1].offsetLeft - track.children[0].offsetLeft;
    const index = Math.max(0, Math.min(features.length - 1, Math.round(track.scrollLeft / step)));
    activeRef.current = index;
    setActive(index);
  };
  const onKeyDown = event => {
    if (!webShowcase || event.target !== event.currentTarget) return;
    const target = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: features.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    goTo(target);
  };

  return <section className="pl-how" id="how-it-works" aria-labelledby="how-title" tabIndex={-1}>
    <h2 className="pl-eyebrow" id="how-title">How it works</h2>
    <noscript><style>{`.pl-showcase-track{display:block;overflow:visible}.pl-showcase-slide{margin-bottom:40px}.pl-showcase-navigation{display:none}`}</style></noscript>
    <div className="pl-feature-showcase" role="region" aria-label="Feels Like Home features"
      aria-roledescription={webShowcase ? 'carousel' : undefined} data-web-showcase={webShowcase ? 'true' : undefined}>
      <div className="pl-showcase-track" id="pl-how-slides" ref={trackRef} onScroll={onScroll} onKeyDown={onKeyDown}
        tabIndex={webShowcase ? 0 : undefined} role={webShowcase ? 'group' : undefined} aria-label={webShowcase ? 'Use Left and Right arrow keys, Home or End to navigate features.' : undefined}>
        {features.map(({ id, title, copy, alt }, index) => <article className="pl-showcase-slide" key={id}
          aria-labelledby={webShowcase ? undefined : `showcase-${id}`} role={webShowcase ? 'group' : undefined}
          aria-roledescription={webShowcase ? 'slide' : undefined} aria-label={webShowcase ? `${index + 1} of ${features.length}: ${title}` : undefined}
          aria-hidden={webShowcase && active !== index ? 'true' : undefined}>
          <div className="pl-showcase-art"><PublicFeatureArtwork id={id} alt={alt} /></div>
          <div className="pl-showcase-copy"><h3 id={`showcase-${id}`}>{title}</h3><p>{copy}</p></div>
        </article>)}
      </div>
      <div className="pl-showcase-navigation" aria-label="Feature slide navigation">
        {webShowcase && <>
          <span className="pl-showcase-count" aria-hidden="true">{String(active + 1).padStart(2, '0')}<span>/04</span></span>
          <button type="button" className="pl-showcase-arrow" aria-label="Previous feature" aria-controls="pl-how-slides" disabled={active === 0} onClick={() => goTo(active - 1)}><ArrowLeft size={18} aria-hidden="true" /></button>
          <div className="pl-showcase-dots">{features.map(({ id, title }, index) => <button key={id} type="button"
            aria-label={`Go to slide ${index + 1}: ${title}`} aria-controls="pl-how-slides" aria-current={active === index ? 'true' : undefined}
            onClick={() => goTo(index)}><span aria-hidden="true" /></button>)}</div>
          <button type="button" className="pl-showcase-arrow" aria-label="Next feature" aria-controls="pl-how-slides" disabled={active === features.length - 1} onClick={() => goTo(active + 1)}><ArrowRight size={18} aria-hidden="true" /></button>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Slide {active + 1} of {features.length}: {features[active].title}</p>
        </>}
      </div>
    </div>
    {/* Preserve the installed shell's original static assets and presentation,
        including when the hidden marketing entry is mounted beside welcome. */}
    <div className="pl-native-feature-fallback">
      <div className="pl-editorial-grid">{features.map(({ id, title, copy, alt }) => <article className="pl-editorial-feature" key={id} aria-labelledby={`native-how-${id}`}>
        <Image src={`/images/homepage-previews/${id}.webp`} alt={alt} width={1448} height={1086} loading="lazy"
          sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1199px) calc((100vw - 80px) / 2), 340px" />
        <h3 id={`native-how-${id}`}>{title}</h3><p>{copy}</p>
      </article>)}</div>
    </div>
    <p className="pl-illustration-note">Illustrative mockups and Match results. Listing-source names do not imply affiliation or direct integration.</p>
  </section>;
}
