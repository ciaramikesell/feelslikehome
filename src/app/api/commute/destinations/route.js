import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveSearch } from '@/lib/supabase/collaboration';
import { addressFingerprint } from '@/lib/commute/address.mjs';
import { geocodeWithGoogle } from '@/lib/commute/google.mjs';
import { rowToCommuteDestination } from '@/lib/commute/data';

function destinationInput(body) {
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  const rawMaximum = body?.maximumMinutes;
  const maximumMinutes = rawMaximum === '' || rawMaximum === null || rawMaximum === undefined
    ? null : Number(rawMaximum);
  if (!label || label.length > 80) return { error: 'Add a label that is 80 characters or fewer.' };
  if (!address || address.length > 200) return { error: 'Add a complete address that is 200 characters or fewer.' };
  if (maximumMinutes !== null && (!Number.isInteger(maximumMinutes) || maximumMinutes < 1 || maximumMinutes > 600)) {
    return { error: 'Maximum commute must be a whole number between 1 and 600 minutes.' };
  }
  return { label, address, maximumMinutes };
}

function geocodeColumns(address, geocode) {
  return {
    address,
    address_fingerprint: addressFingerprint(address),
    latitude: geocode.status === 'resolved' ? geocode.latitude : null,
    longitude: geocode.status === 'resolved' ? geocode.longitude : null,
    normalized_address: geocode.status === 'resolved' ? geocode.normalizedAddress : null,
    geocode_status: geocode.status,
    geocode_provider: geocode.status === 'resolved' ? geocode.provider : 'google',
    geocoded_at: new Date().toISOString(),
  };
}

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };
  const { search } = await resolveActiveSearch(supabase, user.id);
  return { supabase, user, search };
}

export async function POST(request) {
  const ctx = await context();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => null);
  const input = destinationInput(body);
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });

  const geocode = await geocodeWithGoogle(input.address);
  const row = {
    id: crypto.randomUUID(),
    search_id: ctx.search.id,
    user_id: ctx.user.id,
    label: input.label,
    maximum_minutes: input.maximumMinutes,
    ...geocodeColumns(input.address, geocode),
  };
  const { data, error } = await ctx.supabase.from('commute_destinations').insert(row).select().single();
  if (error) {
    console.error('Could not add commute destination', error.code);
    return NextResponse.json({ error: "We couldn't save that place. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ destination: rowToCommuteDestination(data) }, { status: 201 });
}

export async function PATCH(request) {
  const ctx = await context();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const input = destinationInput(body);
  if (!id || input.error) return NextResponse.json({ error: input.error || 'Destination is required.' }, { status: 400 });

  const { data: existing } = await ctx.supabase.from('commute_destinations')
    .select('*').eq('id', id).eq('search_id', ctx.search.id).eq('user_id', ctx.user.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Destination not found.' }, { status: 404 });

  const update = { label: input.label, maximum_minutes: input.maximumMinutes };
  if (input.address !== existing.address) {
    const geocode = await geocodeWithGoogle(input.address);
    Object.assign(update, geocodeColumns(input.address, geocode));
  }
  const { data, error } = await ctx.supabase.from('commute_destinations').update(update)
    .eq('id', id).eq('search_id', ctx.search.id).eq('user_id', ctx.user.id).select().single();
  if (error) {
    console.error('Could not update commute destination', error.code);
    return NextResponse.json({ error: "We couldn't save that place. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ destination: rowToCommuteDestination(data) });
}

export async function DELETE(request) {
  const ctx = await context();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Destination is required.' }, { status: 400 });
  const { error } = await ctx.supabase.from('commute_destinations').delete()
    .eq('id', id).eq('search_id', ctx.search.id).eq('user_id', ctx.user.id);
  if (error) return NextResponse.json({ error: "We couldn't remove that place. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
