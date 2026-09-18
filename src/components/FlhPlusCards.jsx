import { Check, Home, Sparkles } from 'lucide-react';

// Shared Free vs FLH+ pricing cards — used on the public homepage's bridge
// section and the dedicated /flh-plus page, so the two never drift. Purely
// presentational; no purchase action exists yet (see /flh-plus/page.js).
export default function FlhPlusCards({ className = '' }) {
  return (
    <div className={`flh-cards ${className}`}>
      <article className="flh-card">
        <div className="flh-card-icon"><Home size={19} /></div>
        <h3>Free</h3>
        <p className="flh-card-price">$0</p>
        <ul>
          <li><Check size={15} /> Build your My Search preferences</li>
          <li><Check size={15} /> Personalized Match Scores</li>
          <li><Check size={15} /> Compare up to 3 homes</li>
          <li><Check size={15} /> Track Favorites and Want to Tour</li>
        </ul>
        <small>Perfect for narrowing down your first few contenders.</small>
      </article>
      <article className="flh-card is-plus">
        <div className="flh-card-icon"><Sparkles size={19} /></div>
        <h3>FLH+</h3>
        <p className="flh-card-price">$7.99 <span>once</span></p>
        <ul>
          <li><Check size={15} /> Everything in Free</li>
          <li><Check size={15} /> Unlimited homes</li>
          <li><Check size={15} /> Invite a co-buyer <small>(each person keeps their own Match)</small></li>
          <li><Check size={15} /> Connect your Realtor</li>
          <li><Check size={15} /> Shared home-search experience</li>
        </ul>
        <small>One purchase unlocks the search for everyone you invite. Your co-buyer and Realtor don&apos;t purchase separately.</small>
      </article>
    </div>
  );
}
