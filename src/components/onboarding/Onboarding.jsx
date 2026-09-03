'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { BrandMark, TierPicker } from '@/components/ui';
import {
  SEARCH_TYPE_OPTIONS, LAYOUT_OPTIONS, INVESTMENT_PROPERTY_TYPES, ITEMLIST_CATEGORIES, TIER_META,
  isSimpleRentalType, terminology, nextInvestmentTypes, searchTypeLabel,
} from '@/lib/constants';
import { parseNum } from '@/lib/matching';
import { createClient } from '@/lib/supabase/client';
import { updateSearchPriorities, completeOnboarding } from '@/lib/supabase/data';

const TIER_EXPLAIN = [
  { key: 'must', title: 'Must have', desc: "A dealbreaker if it's missing." },
  { key: 'important', title: 'Important', desc: 'This should weigh heavily in your match.' },
  { key: 'nice', title: 'Nice to have', desc: 'A bonus, but not a dealbreaker.' },
  { key: 'dontcare', title: "Don't care", desc: 'Leave it out of my home ratings.' },
];

const ONBOARDING_CATEGORY_BLURBS = {
  location: "Neighborhood, schools, walkability, commute & what's nearby",
  homeFeel: 'Layout, natural light, condition, character & how the home feels',
  exterior: 'Yard, privacy, garage, parking & outdoor space',
  features: "Basement, fireplace, home office & other specific features",
};

function fmtShort(v) {
  const n = parseNum(v);
  if (n === null) return null;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

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

function OnboardingShell({ children }) {
  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div className="hh-corner" style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 20, padding: '32px 32px 30px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function OnboardingStep1({ priorities, patch, onNext }) {
  const term = terminology(priorities.searchType);
  const showLayoutAndLot = priorities.searchType && !isSimpleRentalType(priorities.searchType);
  const showInvestmentTypes = priorities.searchType === 'investment';

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
          {showInvestmentTypes && (
            <div>
              <label className="hh-label">What type of investment property are you looking for?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {INVESTMENT_PROPERTY_TYPES.map((opt) => (
                  <span key={opt} className={`hh-chip ${(priorities.investmentPropertyTypes || []).includes(opt) ? 'on' : ''}`}
                    onClick={() => patch((n) => { n.investmentPropertyTypes = nextInvestmentTypes(n.investmentPropertyTypes || [], opt); return n; })}>
                    {opt}
                  </span>
                ))}
              </div>
            </div>
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

          {showLayoutAndLot && (
            <>
              <div>
                <label className="hh-label">Preferred Home Layout</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {LAYOUT_OPTIONS.map((o) => (
                    <span key={o} className={`hh-chip ${priorities.homeLayout.values.includes(o) ? 'on' : ''}`}
                      onClick={() => patch((n) => { const cur = n.homeLayout.values; n.homeLayout = { ...n.homeLayout, values: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] }; return n; })}>
                      {o}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="hh-label">Minimum Lot Size <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(if desired)</span></label>
                <input className="hh-input" style={{ maxWidth: 180 }} value={priorities.lotSizeTarget.value} onChange={(e) => patch((n) => { n.lotSizeTarget = { ...n.lotSizeTarget, value: e.target.value }; return n; })} placeholder="0.25 acres" />
              </div>
            </>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 className="hh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>What matters most to you?</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '6px 0 0', lineHeight: 1.5 }}>Every home has tradeoffs. Tell us what's non-negotiable — and where you're willing to bend.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {TIER_EXPLAIN.map((t) => (
          <div key={t.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TIER_META[t.key].color }}>{t.title}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{t.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {ITEMLIST_CATEGORIES.map((def) => (
          <div key={def.key}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{def.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '2px 0 8px' }}>{ONBOARDING_CATEGORY_BLURBS[def.key]}</div>
            {def.coreItems.map((item) => (
              <div className="hh-priority-row" key={item.label}>
                <span style={{ fontSize: 13 }}>{item.label}</span>
                <TierPicker
                  value={priorities[def.key]?.tiers?.[item.label] || 'dontcare'}
                  onChange={(t) => patch((n) => { n[def.key] = { ...n[def.key], tiers: { ...n[def.key].tiers, [item.label]: t } }; return n; })}
                />
              </div>
            ))}
          </div>
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

function OnboardingStep3({ priorities, onFinish, onBack }) {
  const basics = [
    priorities.budget.value && `${fmtShort(priorities.budget.value)} max`,
    priorities.bedsMin.value && `${priorities.bedsMin.value}+ bedrooms`,
    priorities.bathsMin.value && `${priorities.bathsMin.value}+ bathrooms`,
  ].filter(Boolean);

  const musts = [];
  const importants = [];
  ITEMLIST_CATEGORIES.forEach((def) => {
    def.coreItems.forEach((item) => {
      const tier = priorities[def.key]?.tiers?.[item.label];
      if (tier === 'must') musts.push(item.label);
      if (tier === 'important') importants.push(item.label);
    });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <h2 className="hh-serif" style={{ fontSize: 24, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Your search is ready.</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '6px 0 0', lineHeight: 1.5 }}>We'll compare every home you add against what matters to you. You can change your priorities anytime.</p>
      </div>

      <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{searchTypeLabel(priorities.searchType) || 'Your search'}</div>
          {basics.length > 0 && <div className="hh-mono" style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{basics.join(' · ')}</div>}
        </div>
        {musts.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brick)', textTransform: 'uppercase', letterSpacing: '.02em' }}>Your must-haves</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 3 }}>{musts.join(' · ')}</div>
          </div>
        )}
        {importants.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '.02em' }}>Most important</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 3 }}>{importants.join(' · ')}</div>
          </div>
        )}
        {musts.length === 0 && importants.length === 0 && basics.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>You skipped ahead — that's fine, you can set all of this in My Search whenever you're ready.</div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" className="hh-btn" onClick={() => onFinish('add-home')}><Plus size={15} /> Add my first home</button>
        <button type="button" className="hh-btn hh-btn-ghost" onClick={() => onFinish('search')}>Fine-tune My Search</button>
      </div>

      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: 0 }}>← Back to what matters</button>
    </div>
  );
}

export default function Onboarding({ userId, searchId, initialPriorities }) {
  const router = useRouter();
  const [priorities, setPriorities] = useState(initialPriorities);
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
    try {
      await completeOnboarding(supabase, userId);
    } catch (e) {
      console.error('Could not mark onboarding complete', e);
    }
    router.push(action === 'add-home' ? '/homes?add=1' : '/search');
    router.refresh();
  };

  return (
    <div className="hh-root">
      <OnboardingShell>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark size={30} />
          <span className="hh-serif" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>Feels Like </span>
            <span style={{ color: 'var(--brick)', fontWeight: 700 }}>Home</span>
          </span>
        </div>
        <OnboardingProgress step={step} />
        {step === 1 && <OnboardingStep1 priorities={priorities} patch={patch} onNext={() => setStep(2)} />}
        {step === 2 && <OnboardingStep2 priorities={priorities} patch={patch} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <OnboardingStep3 priorities={priorities} onFinish={onFinish} onBack={() => setStep(2)} />}
      </OnboardingShell>
    </div>
  );
}
