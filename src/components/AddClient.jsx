'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import Sheet from '@/components/Sheet';
import ClientRecordForm from '@/components/ClientRecordForm';

// "Add client": a private record for someone the Realtor is working with who
// hasn't joined FLH. Creating it shares nothing and invites no one.
export default function AddClient({ label = 'Add client', className = 'hh-btn' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}><UserPlus size={16} /> {label}</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Add a client" size="large" className="hh-client-sheet">
      <p className="flh-sheet-lead">Keep track of someone you’re helping before they join Feels Like Home. Only a name is needed; everything else can wait.</p>
      {open && <ClientRecordForm onCancel={() => setOpen(false)} onSaved={(id) => { setOpen(false); router.push(`/people/clients/${id}`); router.refresh(); }} />}
    </Sheet>
  </>;
}
