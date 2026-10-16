'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Pencil } from 'lucide-react';
import Sheet from '@/components/Sheet';
import ClientRecordForm from '@/components/ClientRecordForm';

// The Realtor's own notes about a connected client, kept apart from everything
// the buyers wrote. Saving the first note opens the Realtor's private record
// for this search (only while they are connected to it).
export default function ClientPrivateNotes({ searchId, record }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const details = record ? [record.contactPhone, record.contactEmail, record.preferredLocations.join(', ')].filter(Boolean) : [];
  return <section className="hh-realtor-section hh-client-private-notes" aria-labelledby="private-notes-title">
    <div className="hh-realtor-section-title">
      <div><span>Only you can see this</span><h2 id="private-notes-title"><Lock size={18} aria-hidden="true" /> Your private notes</h2></div>
      <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setOpen(true)}><Pencil size={14} /> {record?.notes || details.length ? 'Edit' : 'Add a note'}</button>
    </div>
    {record?.notes ? <p className="hh-client-notes">{record.notes}</p> : <p className="hh-muted">Keep timelines, financing and what you heard on tours here. Your clients never see it, and it never changes their search.</p>}
    {details.length > 0 && <p className="hh-client-tile-meta">{details.join(' · ')}</p>}
    {record && <Link className="hh-client-inline-link" href={`/people/clients/${record.id}`}>Open private record</Link>}
    <Sheet open={open} onClose={() => setOpen(false)} title="Your private notes" size="large" className="hh-client-sheet">
      {open && <ClientRecordForm record={record} connectedSearchId={searchId} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />}
    </Sheet>
  </section>;
}
