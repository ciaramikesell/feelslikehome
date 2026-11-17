'use client';

import { useId, useRef, useState } from 'react';
import Sheet from '@/components/Sheet';
import HomePhoto from '@/components/HomePhoto';
import { parsePhotoUrl, serializePhotoFrame } from '@/lib/photoFraming';

// Mount on demand with the URL captured at open. Drag changes only the preview;
// Save delegates a guarded shared-field write, Cancel/Escape write nothing.
export default function PhotoPositioner({ src, onSave, onClose }) {
  const id = useId();
  const initial = useRef(parsePhotoUrl(src));
  const [position, setPosition] = useState(initial.current.position);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = useRef(null);
  const imageSize = useRef({ width: 0, height: 0 });
  const drag = useRef(null);
  const clamp = n => Math.min(100, Math.max(0, n));
  const save = async () => {
    if (saving || failed || !loaded) return;
    setSaving(true); setError('');
    try { await onSave(serializePhotoFrame(src, position), src); onClose(); }
    catch (err) { setError(err.code === 'FLH_SHARED_NOTES_CONFLICT' || err.code === 'FLH_PHOTO_CHANGED' ? 'This photo changed elsewhere. Cancel and refresh before repositioning it.' : 'Couldn’t save the position. Your preview is still here; try Save again.'); }
    finally { setSaving(false); }
  };
  const preview = serializePhotoFrame(src, position);
  return <Sheet open title="Position photo" onClose={() => { if (!saving) onClose(); }} dismissOnBackdrop={!saving} size="default" className="flh-photo-positioner">
    <p>Drag the photo to frame your home, or use the position sliders. Your original image stays untouched.</p>
    <div ref={frame} className="flh-position-preview" role="img" aria-label="Photo framing preview"
      onPointerDown={(event) => {
        if (!loaded || failed || saving) return;
        const rect = frame.current.getBoundingClientRect();
        const scale = Math.max(rect.width / imageSize.current.width, rect.height / imageSize.current.height);
        drag.current = { x: event.clientX, y: event.clientY, position, overflowX: imageSize.current.width * scale - rect.width, overflowY: imageSize.current.height * scale - rect.height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const d = drag.current;
        setPosition({ x: d.overflowX > 1 ? clamp(d.position.x - (event.clientX - d.x) / d.overflowX * 100) : d.position.x, y: d.overflowY > 1 ? clamp(d.position.y - (event.clientY - d.y) / d.overflowY * 100) : d.position.y });
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <HomePhoto src={preview} alt="" onLoad={(event) => { imageSize.current = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setLoaded(true); }} onError={() => setFailed(true)} />
    </div>
    <div className="flh-position-sliders">
      <label htmlFor={`${id}-horizontal`}>Horizontal position <output aria-hidden="true">{Math.round(position.x)}%</output><input id={`${id}-horizontal`} type="range" min="0" max="100" step="1" value={position.x} disabled={saving || failed || !loaded} onChange={e => setPosition(p => ({ ...p, x: Number(e.target.value) }))} /></label>
      <label htmlFor={`${id}-vertical`}>Vertical position <output aria-hidden="true">{Math.round(position.y)}%</output><input id={`${id}-vertical`} type="range" min="0" max="100" step="1" value={position.y} disabled={saving || failed || !loaded} onChange={e => setPosition(p => ({ ...p, y: Number(e.target.value) }))} /></label>
    </div>
    <p className="flh-position-help">Frames reveal different parts of an image. Positioning only moves it where there is extra image outside the frame.</p>
    {failed && <p role="alert">This photo couldn’t load. Cancel and try again.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="flh-position-actions">
      <button type="button" className="hh-btn hh-btn-ghost" disabled={saving} onClick={() => setPosition({ x: 50, y: 50 })}>Center</button>
      <button type="button" className="hh-btn hh-btn-ghost" disabled={saving} onClick={onClose}>Cancel</button>
      <button type="button" className="hh-btn" disabled={saving || failed || !loaded || !initial.current.editable} onClick={save}>{saving ? 'Saving…' : 'Save position'}</button>
    </div>
  </Sheet>;
}
