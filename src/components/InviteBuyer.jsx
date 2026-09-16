'use client';

import { useState } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createBuyerInvitation } from '@/lib/supabase/collaboration';

export default function InviteBuyer() {
  const [open, setOpen] = useState(false); const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { const invite = await createBuyerInvitation(createClient(), email); setLink(`${window.location.origin}/invite/${invite.token}`); } catch { setError("We couldn't create that invitation. Please try again."); } finally { setBusy(false); } };
  if (!open) return <button className="hh-btn hh-invite-buyer-button" onClick={() => setOpen(true)}><UserPlus size={16} /> Invite a buyer</button>;
  return <section className="hh-invite-buyer"><h2>Invite a buyer</h2><p>Invite someone to start or open their own FLH search with you helping as their Realtor.</p>{!link ? <form onSubmit={create}><label>Buyer email<input className="hh-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="buyer@example.com" /></label><div><button className="hh-btn" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div></form> : <div className="hh-invite-link"><p>Invitation ready. Share this secure link with {email}.</p><input className="hh-input" readOnly value={link} onFocus={(event) => event.target.select()} /><button className="hh-btn" onClick={() => navigator.clipboard.writeText(link)}><Copy size={15} /> Copy link</button><small>Expires in 7 days. You cannot see their search until they accept.</small></div>}{error && <p className="hh-error-text" role="alert">{error}</p>}</section>;
}
