'use client';

import { noteEntries } from '@/lib/homeDisplay';

// Shared Notes / Pros / Cons on a home: three plain text boxes, one entry per
// line. They save to the shared home's notes / pros / cons text exactly as
// typed (the card counts and previews one entry per line, never per comma).
// All three are optional.
// Shared with the Home Facts inline editor (HomeFacts.jsx), so both read alike.
export const NOTE_LIST_FIELDS = Object.freeze([
  { key: 'notes', label: 'Notes', marker: '', placeholder: 'HOA details, sewer/water, financing options, recent updates, listing terms, or anything else worth noting.' },
  { key: 'pros', label: 'Pros', marker: '+ ', placeholder: 'Great backyard\nUpdated kitchen' },
  { key: 'cons', label: 'Cons', marker: '− ', placeholder: 'Only one full bath\nBusy road nearby' },
]);
export const noteListHint = (text) => { const count = noteEntries(text).length; return count > 0 ? `${count} · one per line` : 'One per line'; };

export default function NoteListFields({ form, set, idPrefix }) {
  return (
    <div className="hh-edit-notes-fields hh-note-list-fields">
      {NOTE_LIST_FIELDS.map(({ key, label, marker, placeholder }) => {
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className={`hh-note-list-field is-${key}`}>
            <label className="hh-label" htmlFor={id}>
              {marker}{label}
              <span className="hh-note-list-hint" id={`${id}-hint`}>{noteListHint(form[key])}</span>
            </label>
            <textarea id={id} className="hh-textarea" rows={3} aria-describedby={`${id}-hint`} value={form[key] || ''} onChange={(event) => set(key, event.target.value)} placeholder={placeholder} />
          </div>
        );
      })}
    </div>
  );
}
