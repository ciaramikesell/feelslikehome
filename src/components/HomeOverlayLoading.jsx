'use client';

import { useParams } from 'next/navigation';
import { useHomesWorkspace } from '@/components/HomesWorkspace';
import { homeIdentity } from '@/lib/homePresentation';

// The overlay frame, opened instantly with what My Homes already knows (the
// address and photo), while the home's fresh data loads.
export default function HomeOverlayLoading() {
  const { homeId } = useParams();
  const workspace = useHomesWorkspace();
  const home = workspace?.homes.find((candidate) => String(candidate.id) === String(homeId));
  const identity = home ? homeIdentity(home, workspace.priorities) : null;
  return <div className="flh-overlay-backdrop">
    <div className="flh-overlay is-loading" role="dialog" aria-modal="true" aria-label={identity ? `Opening ${identity.accessible}` : 'Opening home'} aria-busy="true">
      <header className="flh-overlay-bar"><div className="flh-overlay-bar-title"><h1>{identity?.primary || 'Opening…'}</h1>{identity?.supporting && <p>{identity.supporting}</p>}</div></header>
      <div className="flh-overlay-scroll">
        <div className="flh-hf2-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="flh-hf2-photo-wrap"><div className="flh-hf2-photo">{home?.photoUrl ? <img src={home.photoUrl} alt="" /> : <span className="flh-skeleton" />}</div></div>
          <div className="flh-hf2-identity"><span className="flh-skeleton is-line" /><span className="flh-skeleton is-line is-short" /></div>
        </div>
        <p className="sr-only" role="status">Loading home details…</p>
      </div>
    </div>
  </div>;
}
