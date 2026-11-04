import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lookupRentCast } from '@/lib/rentcastLookup';

// Server-only: this file runs in a Next.js Route Handler (a Vercel serverless
// function), never in the browser, so RENTCAST_API_KEY is safe to read from
// process.env here — it is never sent to the client.
//
// This route does exactly one property lookup per request: one call to
// /v1/properties (structural facts) and one call to the matching listings
// endpoint (current price/market facts), for the single address provided.
// It doesn't loop, batch, or cache — that's what "limited to the exact lookup
// needed" means for V1. Duplicate-call prevention lives in the UI instead.

export async function POST(request) {
  try {
    // Require a signed-in app user so this route can't be hit anonymously and
    // burn the RentCast quota — this is the "keep it simple" quota guard for V1,
    // not a rate limiter.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    }

    const apiKey = process.env.RENTCAST_API_KEY;
    if (!apiKey) {
      console.error('RENTCAST_API_KEY is not set.');
      return NextResponse.json({ error: "Property lookup isn't configured yet." }, { status: 500 });
    }

    let body = {};
    try { body = await request.json(); } catch { /* missing/invalid body handled below */ }

    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const mode = body.mode === 'rental' || body.mode === 'apartment' ? body.mode : 'sale';

    if (!address) {
      return NextResponse.json({ error: 'An address is required.' }, { status: 400 });
    }
    if (address.length > 200) {
      return NextResponse.json({ error: 'That address looks too long to be valid.' }, { status: 400 });
    }

    const { status, body: payload } = await lookupRentCast(address, mode, apiKey);
    return NextResponse.json(payload, { status });
  } catch (err) {
    console.error('import-listing failed', err);
    return NextResponse.json({ error: 'Something went wrong looking up that address.' }, { status: 500 });
  }
}
