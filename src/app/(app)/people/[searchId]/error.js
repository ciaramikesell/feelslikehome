'use client';
export default function ClientSearchError({ reset }) {
  return <main className="hh-realtor-workspace"><div className="hh-realtor-empty"><h1>We couldn’t load this client search</h1><p>Your access may have changed, or the connection may be unavailable. No client information was shown.</p><button className="hh-btn" onClick={reset}>Try again</button><a className="hh-btn hh-btn-ghost" href="/people">Back to People I’m Helping</a></div></main>;
}
