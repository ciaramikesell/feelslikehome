import { SlidersHorizontal, LayoutGrid, Target } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/ui';

const BENEFITS = [
  { icon: SlidersHorizontal, title: 'Set your priorities', desc: 'Decide what matters — and how much.' },
  { icon: LayoutGrid, title: 'Keep your homes together', desc: 'Compare listings from anywhere.' },
  { icon: Target, title: 'Find your best match', desc: 'See how each home measures up to what matters to you.' },
];

export default function AuthShell({ children }) {
  return (
    <div className="afh-root">
      <div className="afh-grid">
        <div className="afh-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={36} />
            <Wordmark size={29} className="afh-serif" />
          </div>

          <h2 className="afh-serif afh-headline">
            Compare the homes you like.
            <br />
            Find the one that <span style={{ color: 'var(--brick)' }}>feels like home</span>.
          </h2>
          <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '14px 0 0', maxWidth: 420 }}>
            Organize, rate, and compare the homes you're considering based on what matters most to you.
          </p>

          <div className="afh-benefits">
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div className="afh-benefit" key={title}>
                <div className="afh-benefit-icon"><Icon size={17} color="var(--brick)" /></div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="afh-right">
          <div className="afh-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}
