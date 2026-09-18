'use client';
export default function ErrorState({ reset }) {
  return <main className="hh-people-page"><div className="hh-realtor-empty"><h1>We couldn’t load People I’m Helping</h1><p>The workspace is temporarily unavailable. No client information was shown.</p><button className="hh-btn" onClick={reset}>Try again</button></div></main>;
}
