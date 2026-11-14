'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { normalizeFeatureKey } from '@/lib/priorityCategories';

// "Add your own" for one category: a text field and this category's suggestion
// chips, narrowed as the person types. A chip or Add creates (or finds) the
// feature and the importance picker opens straight away. Buttons only — no
// gesture or hidden menu is ever needed.
export default function AddOwnFeature({ title, suggestions, onAdd }) {
  const id = useId();
  const [text, setText] = useState('');
  const typed = normalizeFeatureKey(text);
  const shown = typed ? suggestions.filter((feature) => normalizeFeatureKey(feature.text).includes(typed)) : suggestions;
  const add = (value) => { if (!String(value?.text ?? value).trim()) return; onAdd(value); setText(''); };

  return (
    <section className="flh-ob-pf-add" aria-labelledby={`${id}-label`}>
      <label id={`${id}-label`} className="flh-ob-label" htmlFor={`${id}-input`}>Add your own</label>
      <div className="flh-ob-pf-add-row">
        <span className="flh-ob-input">
          <input
            id={`${id}-input`}
            value={text}
            maxLength={60}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Type a feature"
            aria-describedby={`${id}-hint`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(text); } }}
          />
        </span>
        <button type="button" className="flh-button flh-button-outline flh-ob-pf-add-button" disabled={!text.trim()} onClick={() => add(text)}>
          <Plus size={16} aria-hidden="true" /> Add
        </button>
      </div>
      <p id={`${id}-hint`} className="flh-ob-help">{shown.length ? 'Or tap a suggestion:' : (typed ? `Add “${text.trim()}” as your own.` : 'Type anything that matters to you.')}</p>
      {shown.length > 0 && (
        <ul className="flh-ob-pf-suggestions" aria-label={`Suggestions for ${title}`}>
          {shown.map((feature) => (
            <li key={feature.id}>
              <button type="button" className="flh-ob-pill flh-ob-pf-chip" onClick={() => add(feature)}>
                <Plus size={14} aria-hidden="true" /> {feature.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
