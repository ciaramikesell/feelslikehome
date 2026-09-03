'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { BrandMark } from '@/components/ui';

const DISMISS_KEY = 'flh-install-dismissed';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // starts hidden until we know it's safe to show

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    setDismissed(false);

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    if (isIOS()) setShowIOSHint(true);

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  if (dismissed || (!deferredPrompt && !showIOSHint)) return null;

  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 100,
      maxWidth: 420, margin: '0 auto',
      background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 16,
      boxShadow: '0 1px 2px rgba(46,38,33,0.06), 0 16px 32px -12px rgba(46,38,33,0.28)',
      padding: '14px 14px 14px 16px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <BrandMark size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="hh-serif" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Add to your home screen</div>
        {deferredPrompt ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Get quick access, right from your phone.</div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            Tap <Share size={12} style={{ flexShrink: 0 }} /> then "Add to Home Screen"
          </div>
        )}
      </div>
      {deferredPrompt && (
        <button type="button" className="hh-btn" style={{ padding: '8px 12px', fontSize: 12, flexShrink: 0 }} onClick={install}>
          <Download size={13} /> Install
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}
