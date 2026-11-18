import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { guestOnboardingEnabled } from '@/lib/guest/config';
import { BINDING_COOKIE, DRAFT_TTL, GUEST_CONTINUE, UUID } from '@/lib/guest/draft';
import { exactKeys, readGuestJson, validateGuestTransfer } from '@/lib/guest/validation';
import { transferGuestDraft } from '@/lib/guest/writer';

const options = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: DRAFT_TTL };
const send = (result, status = 200) => NextResponse.json({ result }, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = value => createHash('sha256').update(value).digest('hex');
const addressProof = (secret, address) => digest(`${secret}:${address.trim().toLowerCase()}`);
const validEmail = value => typeof value === 'string' && value.length <= 254 && emailPattern.test(value.trim());
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  if (!guestOnboardingEnabled()) return send('unavailable', 404);
  const origin = process.env.FLH_GUEST_APP_ORIGIN;
  if (request.headers.get('origin') !== origin ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return send('unavailable', 403);

  let body;
  try { body = await readGuestJson(request); }
  catch { return send('invalid_draft', 400); }
  if (!UUID.test(body?.draftId ?? '')) return send('invalid_draft', 400);
  const jar = await cookies();
  const [id, secret, emailDigest] = (jar.get(BINDING_COOKIE)?.value || '').split(':');
  const hasProof = id === body.draftId && /^[0-9a-f]{64}$/.test(secret || '');

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (body.action === 'prepare' && exactKeys(body, ['action', 'draftId', 'email', 'replace']) && typeof body.replace === 'boolean') {
      if (user || !validEmail(body.email)) return send('unavailable', 409);
      const changedEmail = hasProof && emailDigest !== addressProof(secret, body.email);
      if (changedEmail && !body.replace) return send('different_email', 409);
      if (!hasProof || changedEmail) {
        const nextSecret = randomBytes(32).toString('hex');
        jar.set(BINDING_COOKIE, `${body.draftId}:${nextSecret}:${addressProof(nextSecret, body.email)}`, options);
      }
      return send('prepared');
    }
    if (body.action === 'clear' && exactKeys(body, ['action', 'draftId']) && user && hasProof) {
      jar.set(BINDING_COOKIE, '', { ...options, maxAge: 0 });
      return send('cleared');
    }
    if (body.action === 'signup' && exactKeys(body, ['action', 'draftId', 'email', 'password', 'firstName', 'lastName'])) {
      if (user || !hasProof) return send('unavailable', 409);
      const { email, password, firstName, lastName } = body;
      if (!validEmail(email) ||
          typeof password !== 'string' || password.length < 6 || password.length > 72 ||
          ![firstName, lastName].every(value => typeof value === 'string' && value.trim() && value.length <= 100)) {
        return send('invalid_signup', 400);
      }
      const address = email.trim().toLowerCase();
      if (addressProof(secret, address) !== emailDigest) return send('unavailable', 409);
      const marker = digest(`${secret}:${id}:${address}`);
      const { data, error } = await supabase.auth.signUp({
        email: address, password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(GUEST_CONTINUE)}`,
          data: { first_name: firstName.trim(), last_name: lastName.trim(), flh_guest_signup_v1: marker },
        },
      });
      if (error) return send('signup_failed', 400);
      return send(data.session ? 'authenticated' : 'check_email');
    }
    if (!user?.email || !hasProof || addressProof(secret, user.email) !== emailDigest) return send('unavailable', 403);
    const payload = validateGuestTransfer(body);
    if (!payload) return send('invalid_draft', 400);
    return send(await transferGuestDraft(user.id, secret, payload));
  } catch {
    return send('retry', 503);
  }
}
