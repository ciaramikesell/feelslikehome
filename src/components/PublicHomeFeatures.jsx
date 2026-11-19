'use client';

import Image from 'next/image';
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
  const [carousel, setCarousel] = useState(false);
  const [active, setActive] = useState(0);
  const trackRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const narrow = window.matchMedia('(max-width: 639px)');
    const update = () => {
      // Reuse the hosted app's bridge detection and first-paint flag. Width
      // alone cannot distinguish Safari from the remote-hosted Capacitor app.
      ensureNativeShellFlag();
      setCarousel(narrow.matches && !isNativeApp() && !root.hasAttribute(NATIVE_SHELL_ATTRIBUTE));
    };
    update();
    narrow.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: [NATIVE_SHELL_ATTRIBUTE] });
    return () => { narrow.removeEventListener('change', update); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!carousel) return;
    setActive(0);
    trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [carousel]);

  const goTo = index => {
    if (!carousel || isNativeApp() || document.documentElement.hasAttribute(NATIVE_SHELL_ATTRIBUTE)) return;
    const track = trackRef.current;
    const target = Math.max(0, Math.min(features.length - 1, index));
    track.scrollTo({ left: track.children[target].offsetLeft - track.children[0].offsetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const onScroll = () => {
    if (!carousel) return;
    const track = trackRef.current;
    const step = track.children[1].offsetLeft - track.children[0].offsetLeft;
    setActive(Math.max(0, Math.min(features.length - 1, Math.round(track.scrollLeft / step))));
  };
  const onKeyDown = event => {
    if (!carousel || event.target !== event.currentTarget) return;
    const target = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: features.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    goTo(target);
  };

  return <section className="pl-how" id="how-it-works" aria-labelledby="how-title" tabIndex={-1}
    aria-roledescription={carousel ? 'carousel' : undefined} data-web-carousel={carousel ? 'true' : undefined}>
    <h2 className="pl-eyebrow" id="how-title">How it works</h2>
    <div className="pl-editorial-grid" id="pl-how-slides" ref={trackRef} onScroll={onScroll} onKeyDown={onKeyDown}
      tabIndex={carousel ? 0 : undefined} role={carousel ? 'group' : undefined}
      aria-label={carousel ? 'Feature slides. Use Left and Right arrow keys, Home or End to navigate.' : undefined}>
      {features.map(({ id, title, copy, alt }, index) => <article className="pl-editorial-feature" key={id}
        aria-labelledby={`how-${id}`} role={carousel ? 'group' : undefined}
        aria-roledescription={carousel ? 'slide' : undefined} aria-label={carousel ? `${index + 1} of ${features.length}` : undefined}>
        <Image src={`/images/homepage-previews/${id}.webp`} alt={alt} width={1448} height={1086} loading="lazy"
          sizes="(max-width: 639px) calc(100vw - 72px), (max-width: 1199px) calc((100vw - 80px) / 2), (max-width: 1503px) calc((100vw - 144px) / 4), 340px" />
        <h3 id={`how-${id}`}>{title}</h3>
        <p>{copy}</p>
      </article>)}
    </div>
    {carousel && <div className="pl-carousel-navigation" aria-label="Feature slide navigation">
      <button type="button" aria-label="Previous feature" aria-controls="pl-how-slides" disabled={active === 0} onClick={() => goTo(active - 1)}><ArrowLeft size={18} aria-hidden="true" /></button>
      <div className="pl-carousel-dots">{features.map(({ id, title }, index) => <button key={id} type="button"
        aria-label={`Go to slide ${index + 1}: ${title}`} aria-controls="pl-how-slides" aria-current={active === index ? 'true' : undefined}
        onClick={() => goTo(index)}><span aria-hidden="true" /></button>)}</div>
      <button type="button" aria-label="Next feature" aria-controls="pl-how-slides" disabled={active === features.length - 1} onClick={() => goTo(active + 1)}><ArrowRight size={18} aria-hidden="true" /></button>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Slide {active + 1} of {features.length}: {features[active].title}</p>
    </div>}
    <p className="pl-illustration-note">Illustrative mockups and Match results. Listing-source names do not imply affiliation or direct integration.</p>
  </section>;
}
