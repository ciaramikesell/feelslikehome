'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { BrandMark } from '@/components/ui';
import CriteriaPicker from '@/components/CriteriaPicker';
import {
  SEARCH_TYPE_OPTIONS, LAYOUT_OPTIONS, HOME_CONDITION_OPTIONS, INVESTMENT_PROPERTY_TYPES, INVESTMENT_LIVING_PLAN_OPTIONS,
  TIER_META, isSimpleRentalType, showsHomeLayout, showsMultiselectCategory, terminology, toggleWithNoPreference, getItemlistCategories,
  normalizePriorities,
} from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { updateSearchPriorities, completeOnboarding } from '@/lib/supabase/data';

const TIER_LEGEND = [
  { key: 'must', title: 'Must have', desc: "A dealbreaker if it's missing." },
  { key: 'important', title: 'Important', desc: 'This should weigh heavily in your match.' },
  { key: 'nice', title: 'Nice to have', desc: 'A bonus, but not a dealbreaker.' },
];

function OnboardingProgress({ step }) {
  const steps = [{ n: 1, label: 'The basics' }, { n: 2, label: 'What matters' }, { n: 3, label: "You're ready" }];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
              background: step >= s.n ? 'var(--brick)' : 'var(--paper-raised)',
              color: step >= s.n ? '#fff' : 'var(--ink-soft)',
              border: step >= s.n ? 'none' : '1px solid var(--line)',
            }}>
              {step > s.n ? <Check size={12} /> : s.n}
            </div>
            <span style={{ fontSize: 12, fontWeight: step === s.n ? 700 : 500, color: step === s.n ? 'var(--ink)' : 'var(--ink-soft)' }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div style={{ width: 20, height: 1, background: 'var(--line)' }} />}
        </div>
      ))}
    </div>
  );
}

function OnboardingShell({ children, maxWidth = 640 }) {
  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div className="hh-corner" style={{ width: '100%', maxWidth }}>
        <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 20, padding: '32px 32px 30px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function OnboardingStep1({ priorities, patch, onNext }) {
  const term = terminology(priorities.searchType);
  const showLot = priorities.searchType && !isSimpleRentalType(priorities.searchType);
  const showLayout = showsHomeLayout(priorities.searchType);
  const showCondition = showsMultiselectCategory('homeCondition', priorities.searchType);
  const showInvestmentExtras = priorities.searchType === 'investment';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 className="hh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Let's find what feels like home.</h2>

      <div>
        <div className="hh-label" style={{ marginBottom: 8, fontSize: 13 }}>What are you searching for?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {SEARCH_TYPE_OPTIONS.map((o) => (
            <span key={o.key} className={`hh-chip ${priorities.searchType === o.key ? 'on' : ''}`} style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => patch((n) => { n.searchType = n.searchType === o.key ? '' : o.key; return n; })}>
              {o.label}
            </span>
          ))}
        </div>
      </div>

      {priorities.searchType && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
          {showInvestmentExtras && (
            <>
              <div>
                <label className="hh-label">What type of investment property are you looking for?</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {INVESTMENT_PROPERTY_TYPES.map((opt) => (
                    <span key={opt} className={`hh-chip ${(priorities.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`}
                      onClick={() => patch((n) => { n.investmentPropertyTypes = toggleWithNoPreference(n.investmentPropertyTypes || [], opt); return n; })}>
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="hh-label">Planning to live in the property?</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {INVESTMENT_LIVING_PLAN_OPTIONS.map((o) => (
                    <span key={o.key} className={`hh-chip ${priorities.planningToLiveIn === o.key ? 'on' : ''}`}
                      onClick={() => patch((n) => { n.planningToLiveIn = n.planningToLiveIn === o.key ? '' : o.key; return n; })}>
                      {o.label}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label className="hh-label">{term.budgetLabel}</label>
              <input className="hh-input" value={priorities.budget.value} onChange={(e) => patch((n) => { n.budget = { ...n.budget, value: e.target.value }; return n; })} placeholder={term.pricePlaceholder} />
            </div>
            <div>
              <label className="hh-label">Minimum Square Footage</label>
              <input className="hh-input" value={priorities.sqftTarget.value} onChange={(e) => patch((n) => { n.sqftTarget = { ...n.sqftTarget, value: e.target.value }; return n; })} placeholder="1,800" />
            </div>
            <div>
              <label className="hh-label">Minimum Bedrooms</label>
              <input className="hh-input" value={priorities.bedsMin.value} onChange={(e) => patch((n) => { n.bedsMin = { ...n.bedsMin, value: e.target.value }; return n; })} placeholder="3" />
            </div>
            <div>
              <label className="hh-label">Minimum Bathrooms</label>
              <input className="hh-input" value={priorities.bathsMin.value} onChange={(e) => patch((n) => { n.bathsMin = { ...n.bathsMin, value: e.target.value }; return n; })} placeholder="2" />
            </div>
          </div>

          {showCondition && (
            <div>
              <label className="hh-label">Home Condition</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {HOME_CONDITION_OPTIONS.map((o) => (
                  <span key={o} className={`hh-chip ${priorities.homeCondition.values.includes(o) ? 'on' : ''}`}
                    onClick={() => patch((n) => { n.homeCondition = { ...n.homeCondition, values: toggleWithNoPreference(n.homeCondition.values, o) }; return n; })}>
                    {o}
                  </span>
                ))}
              </div>
            </div>
          )}

          {showLayout && (
            <div>
              <label className="hh-label">Preferred Home Layout</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {LAYOUT_OPTIONS.map((o) => (
                  <span key={o} className={`hh-chip ${priorities.homeLayout.values.includes(o) ? 'on' : ''}`}
                    onClick={() => patch((n) => { n.homeLayout = { ...n.homeLayout, values: toggleWithNoPreference(n.homeLayout.values, o) }; return n; })}>
                    {o}
                  </span>
                ))}
              </div>
            </div>
          )}

          {showLot && (
            <div>
              <label className="hh-label">Minimum Lot Size <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(if desired)</span></label>
              <input className="hh-input" style={{ maxWidth: 180 }} value={priorities.lotSizeTarget.value} onChange={(e) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: e.target.value }; return n; })} placeholder="0.25 acres" />
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <button type="button" className="hh-btn hh-btn-ghost" onClick={onNext}>Skip for now</button>
        <button type="button" className="hh-btn" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}

function OnboardingStep2({ priorities, patch, onNext, onBack }) {
  const categories = getItemlistCategories(priorities.searchType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 className="hh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>What matters most to you?</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '6px 0 0', lineHeight: 1.5 }}>
          Every home has tradeoffs. Pick the things you care about, then tell us how much they matter. You can choose a few or get as detailed as you'd like.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {TIER_LEGEND.map((t) => (
          <div key={t.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TIER_META[t.key].color }}>{t.title}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{t.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {categories.map((def) => (
          <CriteriaPicker key={def.key} def={def} priorities={priorities} patch={patch} draggable={false} />
        ))}
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic', margin: 0 }}>You can fine-tune all of this anytime in My Search.</p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="hh-btn hh-btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="hh-btn" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#C1592F', '#74804F', '#C69245', '#3E6B6F'];

function Confetti() {
  const pieces = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: 4 + Math.random() * 92,
    delay: Math.random() * 0.35,
    duration: 1.1 + Math.random() * 0.6,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 5 + Math.random() * 5,
    rotate: Math.random() * 360,
  }));
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 20 }}>
      <style>{`@keyframes hh-confetti-fall { 0% { transform: translateY(-10px) rotate(0deg); opacity: 1; } 100% { transform: translateY(160px) rotate(280deg); opacity: 0; } }`}</style>
      {pieces.map((p) => (
        <span key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.left}%`, width: p.size, height: p.size * 0.6,
          background: p.color, borderRadius: 2, transform: `rotate(${p.rotate}deg)`,
          animation: `hh-confetti-fall ${p.duration}s ease-in ${p.delay}s both`,
        }} />
      ))}
    </div>
  );
}

function OnboardingStep3({ onFinish }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
      <Confetti />
      <BrandMark size={44} />
      <div>
        <h2 className="hh-serif" style={{ fontSize: 25, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Your search is ready!</h2>
        <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', margin: '10px 0 0', lineHeight: 1.6, maxWidth: 400 }}>
          Now comes the fun part. Find homes you like on Zillow, Realtor.com, Homes.com, Trulia, builder websites, or anywhere else you browse. Add them here and Feels Like Home will help you see how each one measures up to what matters to you.
        </p>
      </div>
      <button type="button" className="hh-btn" onClick={() => onFinish('add-home')}><Plus size={15} /> Add my first home</button>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: 0, fontStyle: 'italic' }}>Already have a listing open? Grab the link — you can add it next.</p>
    </div>
  );
}

export default function Onboarding({ userId, searchId, initialPriorities }) {
  const router = useRouter();
  const [priorities, setPriorities] = useState(() => normalizePriorities(initialPriorities));
  const [step, setStep] = useState(1);

  const patch = (updater) => {
    setPriorities((prev) => {
      const next = updater({ ...prev });
      const supabase = createClient();
      updateSearchPriorities(supabase, searchId, next).catch((e) => console.error('Could not save priorities', e));
      return next;
    });
  };

  const onFinish = async (action) => {
    const supabase = createClient();
    try { await completeOnboarding(supabase, userId); } catch (e) { console.error('Could not mark onboarding complete', e); }
    router.push(action === 'add-home' ? '/homes?add=1' : '/search');
  };

  return (
    <div className="hh-root">
      <OnboardingShell maxWidth={step === 3 ? 480 : 640}>
        {step !== 3 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark size={30} />
            <span className="hh-serif" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>Feels Like </span>
              <span style={{ color: 'var(--brick)', fontWeight: 700 }}>Home</span>
            </span>
          </div>
        )}
        {step !== 3 && <OnboardingProgress step={step} />}
        {step === 1 && <OnboardingStep1 priorities={priorities} patch={patch} onNext={() => setStep(2)} />}
        {step === 2 && <OnboardingStep2 priorities={priorities} patch={patch} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <OnboardingStep3 onFinish={onFinish} />}
      </OnboardingShell>
    </div>
  );
}
