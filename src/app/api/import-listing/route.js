import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeRentCastFields } from '@/lib/rentcast';

// Server-only: this file runs in a Next.js Route Handler (a Vercel serverless
// function), never in the browser, so RENTCAST_API_KEY is safe to read from
// process.env here — it's never sent to the client.
//
// This route does exactly one property lookup per request: one call to
// /v1/properties (structural facts) and one call to the matching listings
// endpoint (current price/market facts), for the single address provided.
// It doesn't loop, batch, or cache — that's what "limited to the exact lookup
// needed" means for V1. Duplicate-call prevention lives in the UI instead.

const RENTCAST_BASE = 'https://api.rentcast.io';

async function fetchRentCast(path, address, apiKey) {
  try {
    const url = `${RENTCAST_BASE}${path}?address=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } });

    if (res.status === 404) return { status: 'empty', data: null };
    if (!res.ok) return { status: 'error', data: null, rateLimited: res.status === 429 };

    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : json;
    return { status: first ? 'ok' : 'empty', data: first || null };
  } catch (err) {
    console.error(`RentCast request failed for ${path}`, err);
    return { status: 'error', data: null, rateLimited: false };
  }
}

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
    const mode = body.mode === 'rental' ? 'rental' : 'sale';

    if (!address) {
      return NextResponse.json({ error: 'An address is required.' }, { status: 400 });
    }
    if (address.length > 200) {
      return NextResponse.json({ error: 'That address looks too long to be valid.' }, { status: 400 });
    }

    const listingPath = mode === 'rental' ? '/v1/listings/rental/long-term' : '/v1/listings/sale';

    const [propertyResult, listingResult] = await Promise.all([
      fetchRentCast('/v1/properties', address, apiKey),
      fetchRentCast(listingPath, address, apiKey),
    ]);

    // Both calls failing outright (auth/network/rate-limit) is a real error.
    // Either one individually coming back empty just means "no data from that
    // source for this address" — not an error — so we still return what we have.
    if (propertyResult.status === 'error' && listingResult.status === 'error') {
      if (propertyResult.rateLimited || listingResult.rateLimited) {
        return NextResponse.json(
          { error: "We've hit the property data provider's rate limit. Try again in a bit." },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: 'Property lookup is temporarily unavailable.' }, { status: 502 });
    }

    const { fields, foundAny } = normalizeRentCastFields(propertyResult.data, listingResult.data);

    return NextResponse.json({
      found: foundAny,
      fields,
      message: foundAny ? undefined : 'No property data was found for that address — you can enter details manually.',
    });
  } catch (err) {
    console.error('import-listing failed', err);
    return NextResponse.json({ error: 'Something went wrong looking up that address.' }, { status: 500 });
  }
}
