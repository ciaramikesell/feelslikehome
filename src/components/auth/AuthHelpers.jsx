'use client';

import { useState } from 'react';
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function PasswordField({ label, value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="afh-label">{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="afh-input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          style={{ paddingRight: 40 }}
        />
        <button type="button" className="afh-eye-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

export function Banner({ kind, children }) {
  const styles = {
    info: { bg: 'rgba(62,107,111,0.1)', border: 'var(--blue)', color: '#2C4C4F' },
    success: { bg: 'rgba(116,128,79,0.12)', border: 'var(--moss)', color: '#4E5736' },
    error: { bg: 'rgba(193,89,47,0.1)', border: 'var(--brick)', color: 'var(--brick)' },
  };
  const s = styles[kind] || styles.info;
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: s.bg, border: `1px solid ${s.border}`, color: s.color, fontSize: 12.5, padding: '10px 12px', borderRadius: 12, lineHeight: 1.4 }}>
      <Icon size={14} style={{ marginTop: 1, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

export const Spinner = () => <Loader2 size={15} style={{ animation: 'afh-spin 1s linear infinite' }} />;
