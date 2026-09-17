'use client';

import { useEffect, useRef } from 'react';
import AuthForm from '@/components/auth/AuthForm';

export default function LandingAuthPopover({ mode, onModeChange, onClose, returnFocusRef, isRealtorEntry = false, redirectTo = '/' }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    const onPointerDown = (event) => { if (!dialogRef.current?.contains(event.target)) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  return <div ref={dialogRef} className="pl-auth-popover" role="dialog" aria-modal="false" aria-label={mode === 'sign-in' ? 'Sign in' : isRealtorEntry ? 'Create Realtor account' : 'Create account'}><AuthForm initialMode={mode} inline onModeChange={onModeChange} isRealtorEntry={isRealtorEntry} redirectTo={redirectTo} /></div>;
}
