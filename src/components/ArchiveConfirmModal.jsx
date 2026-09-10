'use client';

import { useState } from 'react';

export default function ArchiveConfirmModal({ home, onCancel, onConfirm }) {
  const [reason, setReason] = useState(home.rejectionReason || '');
  return (
    <div className="hh-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="hh-modal hh-corner" style={{ maxWidth: 440, padding: 26 }}>
        <h3 className="hh-serif" style={{ fontSize: 18, margin: 0, fontWeight: 600, color: 'var(--ink)' }}>Archive this home?</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: '10px 0 16px' }}>
          {home.address || 'This home'} will be removed from your active homes, but we&apos;ll keep your ratings and notes. You can restore it anytime from Archive.
        </p>
        <label className="hh-label" style={{ marginBottom: 6, display: 'block' }}>Why are you ruling it out? (optional)</label>
        <textarea className="hh-textarea" style={{ minHeight: 70, width: '100%' }} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Too expensive, wrong location, missing a must-have" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button className="hh-btn hh-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hh-btn" style={{ background: 'var(--brick)', borderColor: 'var(--brick)' }} onClick={() => onConfirm(reason.trim())}>Archive home</button>
        </div>
      </div>
    </div>
  );
}
