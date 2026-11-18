import 'server-only';
import pg from 'pg';
import { guestOnboardingEnabled } from './config.js';

let writer;

export async function transferGuestDraft(userId, secret, draft) {
  if (!guestOnboardingEnabled()) throw new Error('Guest transfer disabled');
  if (!writer) {
    const url = new URL(process.env.FLH_GUEST_WRITER_DATABASE_URL);
    if (url.username !== 'flh_guest_writer' || url.search || url.hash || !url.password ||
        !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid writer configuration');
    writer = new pg.Pool({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ...(process.env.FLH_GUEST_WRITER_CA && { ca: process.env.FLH_GUEST_WRITER_CA }) },
      max: 2,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 10_000,
      statement_timeout: 5000,
      query_timeout: 6500,
    });
    // Pool errors can contain connection details. The caller gets a generic retry.
    writer.on('error', () => {});
  }
  const { rows } = await writer.query(
    'select flh_guest_transfer.save_guest_onboarding_v1($1, $2, $3, $4, $5) as result',
    [userId, draft.draftId, secret, draft.priorities, draft.progress],
  );
  return rows[0]?.result ?? 'retry';
}
