'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Bookmark, Check, ChevronLeft, Copy, Mail, MessageCircle, MoreHorizontal, Share, StickyNote } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { confirmHaptic, selectionHaptic, successHaptic } from '@/lib/haptics';

// An optional, replayable practice run of sharing a listing into Feels Like
// Home. Everything inside is a clearly labelled simulation drawn with FLH's
// own styling — a fictional listing, generic placeholder destinations and the
// FLH mark — not a copy of the real iOS Share Sheet or of any other app.
//
// One thing to do per step, and the person does it: tap Share, then tap Feels
// Like Home. Skip and Back are always available; nothing is stored, so it can
// be replayed any time (native welcome, Account → Help) and never blocks
// sign-up, sign-in or a deep link.
export const SHARE_TUTORIAL_STEPS = ['listing', 'sheet', 'saved'];

const TITLES = {
  listing: 'Found a home you like? Tap Share.',
  sheet: 'Now tap Feels Like Home.',
  saved: 'A listing, seen through your priorities.',
};

// Fictional example listing. The photo is existing, approved FLH feature
// photography (public/images/onboarding).
const EXAMPLE = {
  photo: '/images/onboarding/front-porch.webp',
  price: '$485,000',
  facts: '3 bd · 2 ba · 1,840 sq ft',
  address: '14 Linden Lane, Maple Hollow',
};

// Generic stand-ins for "other places you could share to". Neutral tiles and
// plain words — deliberately not any real app's icon or name styling.
const OTHER_DESTINATIONS = [
  { id: 'message', label: 'Message', Icon: MessageCircle },
  { id: 'mail', label: 'Mail', Icon: Mail },
  { id: 'notes', label: 'Notes', Icon: StickyNote },
];

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function ShareTutorial({ onClose }) {
  const [step, setStep] = useState('listing');
  const [sample, setSample] = useState('island');
  const [hint, setHint] = useState(null); // null | 'other' | 'more'
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const firstRender = useRef(true);
  const restoreFocusRef = useRef(null);
  const stepIndex = SHARE_TUTORIAL_STEPS.indexOf(step);

  const close = useCallback(() => onClose?.(), [onClose]);

  const goBack = () => {
    setHint(null);
    if (stepIndex === 0) close();
    else setStep(SHARE_TUTORIAL_STEPS[stepIndex - 1]);
  };

  const replay = () => { setHint(null); setStep('listing'); };

  // Open: remember focus, lock page scroll, start on the title. Close: undo.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    titleRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = restoreFocusRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, []);

  // Each new step moves focus to its one-line instruction, so a screen reader
  // hears what to do next and keyboard users start from the top of the step.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    titleRef.current?.focus();
  }, [step]);

  useEffect(() => { if (step === 'saved') successHaptic(); }, [step]);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || []).filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const tapShare = () => { confirmHaptic(); setHint(null); setStep('sheet'); };
  const tapFlh = () => { confirmHaptic(); setHint(null); setStep('saved'); };
  const tapOther = () => { selectionHaptic(); setHint('other'); };
  const tapMore = () => { selectionHaptic(); setHint('more'); };

  return (
    <div className="flh-st-backdrop">
      <div ref={dialogRef} className={`flh-st is-${step}`} role="dialog" aria-modal="true" aria-labelledby="flh-st-title" aria-describedby="flh-st-sim" onKeyDown={onKeyDown}>
        <header className="flh-st-bar">
          <button type="button" className="flh-st-nav flh-press" onClick={goBack}><ChevronLeft size={18} aria-hidden="true" /> Back</button>
          <ol className="flh-st-progress" aria-label={`Step ${stepIndex + 1} of ${SHARE_TUTORIAL_STEPS.length}`}>
            {SHARE_TUTORIAL_STEPS.map((id, index) => <li key={id} className={index <= stepIndex ? 'is-done' : ''} aria-hidden="true" />)}
          </ol>
          {step === 'saved'
            ? <span className="flh-st-nav-spacer" aria-hidden="true" />
            : <button type="button" className="flh-st-nav flh-st-skip flh-press" onClick={close}>Skip</button>}
        </header>

        <p id="flh-st-sim" className="flh-st-kicker">Practice run · a pretend Share Sheet</p>
        <h2 id="flh-st-title" ref={titleRef} tabIndex={-1} className="flh-st-title">{TITLES[step]}</h2>

        <div className="flh-st-stage">
          <article className="flh-st-listing" aria-label="Example listing" inert={step !== 'listing'}>
            <div className="flh-st-listing-bar">
              <span className="flh-st-listing-source">Example listing</span>
              <button type="button" className={`flh-st-share flh-press ${step === 'listing' ? 'is-target' : ''}`} onClick={tapShare}>
                <Share size={17} aria-hidden="true" /> Share
              </button>
            </div>
            <div className="flh-st-listing-photo"><Image src={EXAMPLE.photo} alt="" fill sizes="(max-width: 480px) 100vw, 440px" /></div>
            <div className="flh-st-listing-copy">
              <b>{EXAMPLE.price}</b>
              <span>{EXAMPLE.facts}</span>
              <span>{EXAMPLE.address}</span>
            </div>
          </article>

          {step === 'sheet' && (
            <section className="flh-st-sheet" aria-label="Pretend Share Sheet">
              <div className="flh-st-sheet-grabber" aria-hidden="true" />
              <div className="flh-st-sheet-head">
                <span className="flh-st-sheet-thumb"><Image src={EXAMPLE.photo} alt="" fill sizes="40px" /></span>
                <span><b>{EXAMPLE.address.split(',')[0]}</b><small>Example listing</small></span>
              </div>
              <div className="flh-st-apps" role="group" aria-label="Share to">
                <button type="button" className="flh-st-app is-flh is-target flh-press" onClick={tapFlh}>
                  <span className="flh-st-app-icon"><BrandMark size={34} /></span>
                  <span className="flh-st-app-label">Feels Like Home</span>
                </button>
                {OTHER_DESTINATIONS.map(({ id, label, Icon }) => (
                  <button key={id} type="button" className="flh-st-app flh-press" onClick={tapOther}>
                    <span className="flh-st-app-icon is-generic"><Icon size={22} aria-hidden="true" /></span>
                    <span className="flh-st-app-label">{label}</span>
                  </button>
                ))}
                <button type="button" className="flh-st-app flh-press" onClick={tapMore}>
                  <span className="flh-st-app-icon is-generic"><MoreHorizontal size={22} aria-hidden="true" /></span>
                  <span className="flh-st-app-label">More</span>
                </button>
              </div>
              <div className="flh-st-actions" aria-hidden="true">
                <span><Copy size={16} /> Copy</span>
                <span><Bookmark size={16} /> Add Bookmark</span>
              </div>
              <p className="flh-st-hint" role="status">
                {hint === 'other' && 'Just for show here — look for Feels Like Home.'}
                {hint === 'more' && 'If Feels Like Home is available, More → Edit lets you add it to Favorites. Otherwise, copy the listing link.'}
              </p>
            </section>
          )}

          {step === 'saved' && (
            <section className="flh-st-saved" aria-label="Saved">
              <span className="flh-st-saved-check" aria-hidden="true"><Check size={30} strokeWidth={3} /></span>
              <p>Import a listing, review its facts, then see what fits. Try a priority in this fictional example:</p>
              <div className="flh-st-sample-options" role="group" aria-label="Example priorities">
                <button type="button" aria-pressed={sample === 'island'} onClick={() => setSample('island')}>Kitchen Island</button>
                <button type="button" aria-pressed={sample === 'tub'} onClick={() => setSample('tub')}>Soaking Tub</button>
              </div>
              <p className="flh-st-sample-result" role="status">{sample === 'island' ? 'Kitchen Island: confirmed in this example listing. A detail you can compare against your own priorities.' : 'Soaking Tub: unknown in this example listing. Missing information never counts against a home.'}</p>
              <p>On iPhone, look for Feels Like Home in the listing’s Share Sheet. You can always copy the link and paste it into Add Home instead.</p>
            </section>
          )}
        </div>

        {step === 'saved' && (
          <div className="flh-st-after">
            <ul className="flh-st-facts">
              <li>Practice only — no listing is imported or saved here.</li>
              <li>Its spot in the Share Sheet varies by app and iOS version.</li>
              <li>Don&rsquo;t see it? Copy the listing link and paste it into Add Home.</li>
              <li>This is the app&rsquo;s share option — not an Add to Home Screen shortcut.</li>
            </ul>
            <div className="flh-st-done-row">
              <button type="button" className="flh-st-done flh-press" onClick={close}>Done</button>
              <button type="button" className="flh-st-replay flh-press" onClick={replay}>Practice again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
