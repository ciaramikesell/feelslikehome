'use client';

import { useState } from 'react';
import { Copy, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createRealtorConnectionRequest } from '@/lib/supabase/collaboration';

// Realtor Home option 1: "Connect with a buyer who already uses FLH". This
// never grants access on its own — it only creates a pending request. The
// buyer sees it when they open the link and must explicitly approve before
// any search_members row (and therefore any access) is created. Knowing a
// buyer's email is never enough on its own: entering an unregistered email
// produces the exact same "request sent" result as a real account would, so
// this can't be used to probe which emails have FLH accounts.
export default function ConnectBuyer() {
  const [open, setOpen] = useState(false); const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { const invite = await createRealtorConnectionRequest(createClient(), email); setLink(`${window.location.origin}/invite/${invite.token}`); } catch { setError("We couldn't create that request. Please try again."); } finally { setBusy(false); } };
  if (!open) return <button className="hh-btn hh-invite-buyer-button" onClick={() => setOpen(true)}><UserCheck size={16} /> Connect with a buyer</button>;
  return <section className="hh-invite-buyer"><h2>Connect with a buyer</h2><p>Send a connection request to a buyer who already has a Feels Like Home search. They&apos;ll need to approve it before you can see anything.</p>{!link ? <form onSubmit={create}><label>Buyer email<input className="hh-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="buyer@example.com" /></label><div><button className="hh-btn" disabled={busy}>{busy ? 'Sending…' : 'Send connection request'}</button><button type="button" className="hh-btn hh-btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div></form> : <div className="hh-invite-link"><p>Request ready. Share this secure link with {email}.</p><input className="hh-input" readOnly value={link} onFocus={(event) => event.target.select()} /><button className="hh-btn" onClick={() => navigator.clipboard.writeText(link)}><Copy size={15} /> Copy link</button><small>Expires in 7 days. You won&apos;t see their search unless they approve.</small></div>}{error && <p className="hh-error-text" role="alert">{error}</p>}</section>;
}
