'use client';

import Link from 'next/link';
import { StatusTag } from '@/components/MobileSystem';

// How a home compares with the participant's Search Basics — facts only. Basics
// are not weighted, so nothing here changes Match; a detail the home doesn't
// establish yet reads as Unknown, never as outside the search.
export default function SearchBasicsPanel({ basics, readOnly = false }) {
  if (!basics?.length) return null;
  return (
    <section className="flh-card flh-search-basics" aria-labelledby="search-basics-heading">
      <p className="flh-section-kicker" id="search-basics-heading">{readOnly ? 'Their Search Basics' : 'Your Search Basics'}</p>
      <ul>
        {basics.map((basic) => (
          <li key={basic.key}>
            <span className="flh-search-basics-copy">
              <strong>{basic.label}</strong>
              <span>{basic.evaluated ? basic.detail : 'Not known for this home yet'} · wanted {basic.wanted}</span>
            </span>
            {!basic.evaluated
              ? <StatusTag tone="unknown">Unknown</StatusTag>
              : basic.met ? <StatusTag tone="positive">Fits</StatusTag> : <StatusTag tone="negative">Outside</StatusTag>}
          </li>
        ))}
      </ul>
      <p className="flh-detail-match-note">Search Basics are guideposts, not Match weights.{!readOnly && <> Edit them in <Link href="/search">My Search</Link>.</>}</p>
    </section>
  );
}
