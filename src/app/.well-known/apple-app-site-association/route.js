import { NextResponse } from 'next/server';
import { buildAasa } from '@/lib/aasa';

// Served at the exact, extension-less path Apple's Universal Links crawler
// requires: https://feelslikehome.app/.well-known/apple-app-site-association
// See docs/universal-links.md for the full audit and rationale behind this,
// and src/lib/aasa.js for the (independently testable) document structure.
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID || '';
  if (!teamId) {
    console.error('APPLE_TEAM_ID is not set — serving an inert AASA with no app association.');
  }
  return NextResponse.json(buildAasa(teamId), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
