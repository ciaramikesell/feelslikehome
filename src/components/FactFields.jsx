'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

// Directly editable Home Facts controls. No Edit buttons and no Save: a text
// field commits after a short pause in typing and on blur; a dropdown commits on
// selection. Each control renders plain text instead when it is read-only.
//
// Shared conventions:
//   - an empty value is Unknown: shown with a subtle warm highlight, never "No";
//   - `failed` marks a value that couldn't be saved (the overlay offers Retry);
//   - a field only writes when the person actually changed it, so focusing a
//     legacy value (a "8712 sq ft" lot, a '4' garage) never rewrites it.

const DEBOUNCE_MS = 900;
const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a || []) === JSON.stringify(b || []) : String(a ?? '').trim() === String(b ?? '').trim());

// A text input that reads as text until it's used.
//   format(value)  -> what shows when not focused
//   edit(value)    -> what the input holds when focus arrives (default: format)
//   parse(text)    -> the value to store; undefined means "not valid, revert"
//   invalidMessage -> optional. With it, text that doesn't parse is kept on
//                     screen with this message (on Enter or leaving the field,
//                     never mid-typing) instead of quietly reverting; nothing
//                     is saved until it is corrected or cleared.
export function QuietInput({
  id, label, value, onCommit, readOnly = false, failed = false, format = (v) => (v ?? ''), edit = null, parse = (t) => t.trim(),
  placeholder = 'Unknown', inputMode, className = '', size, registerDraft, labelHidden = true, suffix = null, autoComplete = 'off', list,
  multiline = false, invalidMessage = null,
}) {
  const [draft, setDraft] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const invalidRef = useRef(false);
  const touched = useRef(false);
  const timer = useRef(null);
  const latest = useRef({ value, onCommit, parse, draft: null });
  latest.current = { value, onCommit, parse, draft };
  const shown = draft ?? format(value);
  const unknown = value === null || value === undefined || String(value).trim() === '';

  // explicit: Enter, leaving the field, or Close — not the typing pause.
  const commit = ({ explicit = true } = {}) => {
    clearTimeout(timer.current);
    const { draft: text, value: stored, parse: toValue, onCommit: save } = latest.current;
    if (!touched.current || text === null) { registerDraft?.(id, null); return; }
    const next = toValue(text);
    if (next === undefined && invalidMessage) {
      // Keep the text (and the pending draft) so it can be fixed; save nothing.
      if (explicit) { invalidRef.current = true; setInvalid(true); }
      return;
    }
    touched.current = false;
    registerDraft?.(id, null);
    invalidRef.current = false;
    setInvalid(false);
    if (next === undefined) { setDraft(null); return; }
    if (!same(next, stored)) save(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => { clearTimeout(timer.current); commitRef.current(); }, []);

  const Field = multiline ? 'textarea' : 'input';
  if (readOnly) {
    return <span className={`flh-fact-text ${unknown ? 'is-unknown' : ''} ${className}`}>{unknown ? 'Unknown' : format(value)}{!unknown && suffix}</span>;
  }
  const errorId = invalid ? `${id}-invalid` : undefined;
  return <><span className={`flh-quiet ${unknown ? 'is-unknown' : ''} ${failed || invalid ? 'is-failed' : ''} ${className}`}>
    {label && <label htmlFor={id} className={labelHidden ? 'sr-only' : 'flh-quiet-label'}>{label}</label>}
    {/* multiline: a one-row textarea that wraps (a long street address), still one value. */}
    <Field
      id={id} className="flh-quiet-input" value={shown} rows={multiline ? 1 : undefined} placeholder={placeholder} inputMode={inputMode} size={size} autoComplete={autoComplete} list={list}
      aria-invalid={failed || invalid || undefined} aria-describedby={errorId}
      onFocus={() => { if (draft === null) setDraft(edit ? edit(value) : format(value)); }}
      onChange={(event) => {
        touched.current = true;
        invalidRef.current = false;
        setInvalid(false);
        setDraft(event.target.value);
        registerDraft?.(id, () => commitRef.current());
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commitRef.current({ explicit: false }), DEBOUNCE_MS);
      }}
      onBlur={() => { commitRef.current(); if (!invalidRef.current) setDraft(null); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitRef.current(); } }}
    />
    {suffix && <span className="flh-quiet-suffix" aria-hidden="true">{suffix}</span>}
  </span>{invalid && <small id={errorId} className="flh-quiet-error" role="alert">{invalidMessage}</small>}</>;
}

// A native select. `choices` is [[value, label], …]; '' is Unknown and is
// always offered first. A saved value that isn't offered stays visible.
export function SelectField({ id, label, value, choices, onCommit, readOnly = false, failed = false, labelHidden = true, unknownLabel = 'Unknown' }) {
  const current = value === null || value === undefined ? '' : String(value);
  const options = current && !choices.some(([key]) => key === current) ? [...choices, [current, current]] : choices;
  const text = options.find(([key]) => key === current)?.[1] || '';
  if (readOnly) return <span className={`flh-fact-text ${current ? '' : 'is-unknown'}`}>{text || 'Unknown'}</span>;
  return <span className={`flh-select ${current ? '' : 'is-unknown'} ${failed ? 'is-failed' : ''}`}>
    {label && <label htmlFor={id} className={labelHidden ? 'sr-only' : 'flh-quiet-label'}>{label}</label>}
    <select id={id} value={current} aria-invalid={failed || undefined} onChange={(event) => onCommit(event.target.value || null)}>
      <option value="">{unknownLabel}</option>
      {options.map(([key, optionLabel]) => <option key={key} value={key}>{optionLabel}</option>)}
    </select>
    <ChevronDown size={15} aria-hidden="true" />
  </span>;
}

// A compact "choose any that apply" dropdown: the chosen values show as small
// tokens (each removable), and the menu holds a checkbox per choice plus
// Unknown, which clears them. Commits on every change.
export function MultiSelectField({ id, label, values, choices, onCommit, readOnly = false, failed = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = `${id}-menu`;
  const selected = Array.isArray(values) ? values : [];
  const all = [...choices, ...selected.filter((value) => !choices.some(([key]) => key === value)).map((value) => [value, value])];
  const labelOf = (value) => all.find(([key]) => key === value)?.[1] || value;
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      // Closes only this menu, not the overlay around it.
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector('.flh-multi-toggle')?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);

  if (readOnly) return <span className={`flh-fact-text ${selected.length ? '' : 'is-unknown'}`}>{selected.length ? selected.map(labelOf).join(' · ') : 'Unknown'}</span>;
  const toggle = (key) => onCommit(selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key]);
  return <div className={`flh-multi ${selected.length ? '' : 'is-unknown'} ${failed ? 'is-failed' : ''} ${open ? 'is-open' : ''}`} ref={rootRef}>
    <div className="flh-multi-field">
      {selected.length > 0 && <ul className="flh-multi-tokens" aria-label={`${label}: chosen`}>
        {selected.map((value) => <li key={value}><span>{labelOf(value)}</span><button type="button" onClick={() => toggle(value)} aria-label={`Remove ${labelOf(value)} from ${label}`}><X size={12} aria-hidden="true" /></button></li>)}
      </ul>}
      <button type="button" id={id} className="flh-multi-toggle" aria-expanded={open} aria-controls={menuId} aria-label={`${label}: ${selected.length ? selected.map(labelOf).join(', ') : 'Unknown'}. Choose`} onClick={() => setOpen((value) => !value)}>
        {!selected.length && <span className="flh-multi-placeholder">Unknown</span>}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
    </div>
    {open && <div className="flh-multi-menu" id={menuId} role="group" aria-label={`${label} — choose any that apply`}>
      {all.map(([key, optionLabel]) => <label key={key} className={selected.includes(key) ? 'is-on' : ''}>
        <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} />
        <span className="flh-multi-check" aria-hidden="true">{selected.includes(key) && <Check size={12} />}</span>{optionLabel}
      </label>)}
      <label className={selected.length ? '' : 'is-on'}>
        <input type="checkbox" checked={!selected.length} onChange={() => { if (selected.length) onCommit([]); }} />
        <span className="flh-multi-check" aria-hidden="true">{!selected.length && <Check size={12} />}</span>Unknown
      </label>
    </div>}
  </div>;
}

// Collapsed behind a row on phones; always open on wider screens (CSS hides the
// toggle and shows the body there).
export function PhoneCollapse({ id, title, summary, children, className = '' }) {
  const [open, setOpen] = useState(false);
  return <div className={`flh-phone-collapse ${open ? 'is-open' : ''} ${className}`}>
    <button type="button" className="flh-phone-collapse-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <span><strong>{title}</strong>{summary && <small>{summary}</small>}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div id={id} className="flh-phone-collapse-body" data-open={open ? 'true' : 'false'}>{children}</div>
  </div>;
}
