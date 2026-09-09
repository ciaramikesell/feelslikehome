'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  BETA_FEEDBACK_ENABLED,
  BETA_FEEDBACK_MESSAGE_MAX,
  BETA_FEEDBACK_TYPES,
  buildBetaFeedbackPayload,
  shouldShowBetaFeedback,
  submitBetaFeedback,
} from '@/lib/betaFeedback';
import { createClient } from '@/lib/supabase/client';

const TYPE_LABELS = {
  broken: "Something's broken",
  confusing: 'Confusing',
  idea: 'Idea',
};

export default function BetaFeedback({ userId, searchId = null, searchType = null, appVersion = null, enabled = BETA_FEEDBACK_ENABLED }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [feedbackType, setFeedbackType] = useState(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);
  useEffect(() => {
    if (open && status !== 'success') textareaRef.current?.focus();
  }, [open, status]);

  if (!shouldShowBetaFeedback(enabled)) return null;

  const close = () => {
    if (status !== 'submitting') setOpen(false);
  };

  const chooseType = (type) => {
    const next = feedbackType === type ? null : type;
    setFeedbackType(next);
    if (next !== 'broken' && next !== 'confusing') setIsBlocking(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (status === 'submitting') return;
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Please tell us what you noticed.');
      textareaRef.current?.focus();
      return;
    }

    setStatus('submitting');
    setError('');
    try {
      const payload = buildBetaFeedbackPayload({
        userId,
        pathname,
        searchId,
        searchType,
        feedbackType,
        message: trimmed,
        isBlocking,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent,
        appVersion,
      });
      await submitBetaFeedback(createClient(), payload);
      setStatus('success');
      resetTimer.current = setTimeout(() => {
        setMessage('');
        setFeedbackType(null);
        setIsBlocking(false);
        setStatus('idle');
        setOpen(false);
      }, 1400);
    } catch {
      setStatus('idle');
      setError("Couldn't send that just now. Your note is still here — please try again.");
    }
  };

  return (
    <div className={`beta-feedback ${open ? 'is-open' : ''}`} onKeyDown={(event) => event.key === 'Escape' && close()}>
      {!open && (
        <button type="button" className="beta-feedback-tab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded="false">
          Feedback
        </button>
      )}
      {open && (
        <section className="beta-feedback-drawer" role="dialog" aria-modal="false" aria-labelledby="beta-feedback-title">
          <div className="beta-feedback-heading">
            <div>
              <h2 id="beta-feedback-title" className="hh-serif">Send feedback</h2>
              <p>See something weird, confusing, or worth changing? Tell us while it&apos;s fresh.</p>
            </div>
            <button type="button" className="beta-feedback-close" onClick={close} aria-label="Close feedback">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {status === 'success' ? (
            <div className="beta-feedback-success" role="status">Thanks — got it!</div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="beta-feedback-types" aria-label="Feedback type (optional)">
                {BETA_FEEDBACK_TYPES.map((type) => (
                  <button key={type} type="button" className={`hh-chip ${feedbackType === type ? 'on' : ''}`} aria-pressed={feedbackType === type} onClick={() => chooseType(type)}>
                    {TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
              <label className="hh-label" htmlFor="beta-feedback-message">What did you notice?</label>
              <textarea
                ref={textareaRef}
                id="beta-feedback-message"
                className="hh-textarea beta-feedback-message"
                value={message}
                maxLength={BETA_FEEDBACK_MESSAGE_MAX}
                required
                onChange={(event) => { setMessage(event.target.value); setError(''); }}
              />
              {(feedbackType === 'broken' || feedbackType === 'confusing') && (
                <label className="beta-feedback-blocking">
                  <input type="checkbox" checked={isBlocking} onChange={(event) => setIsBlocking(event.target.checked)} />
                  I couldn&apos;t continue
                </label>
              )}
              {error && <p className="beta-feedback-error" role="alert">{error}</p>}
              <div className="beta-feedback-actions">
                <span>{message.length}/{BETA_FEEDBACK_MESSAGE_MAX}</span>
                <button className="hh-btn" type="submit" disabled={status === 'submitting'}>
                  {status === 'submitting' ? 'Sending…' : 'Send feedback'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
