'use client';

import { useId, useState } from 'react';
import { PETS_ANSWERS, petsChangeMessage, petsMovingAnswer, petsProvenance, restorePets, setPetsMoving } from '@/lib/rentalPets';
import { PETS_ANSWER_TEXT, PETS_QUESTION, petsAnswerHints } from '@/lib/priorityCategories';
import FeatureVisual from './FeatureVisual';

// Rental Essentials: "Will pets be moving with you?" (spec §7, D2).
//   Yes          → Pet-Friendly becomes a Must Have (unless the renter already
//                  set its level themselves); the status line says so, with Undo.
//   No / Not sure → no anti-pet requirement. A Must Have FLH set is put back.
// Every write goes through setPetsMoving; Undo is restorePets with the exact
// snapshot setPetsMoving returned. Skipping the screen writes nothing.
// FLH asks nothing else: no pet type, breed, size, weight, count or name.


// The quiet line under the choices, describing the saved state (never a change).
function restingLine(priorities) {
  const { answer, tier, automatic } = petsProvenance(priorities);
  if (automatic) return 'Pet-Friendly is a Must Have because pets are moving with you.';
  if (answer === 'yes' && tier === 'must') return 'Pet-Friendly is already one of your Must Haves.';
  if (answer && tier) return null; // the renter’s own level; the status line explains it after a change
  if (answer === 'no' || answer === 'not_sure') return 'No pet requirement. A home is never marked down for its pet policy.';
  return null;
}

export default function PetsQuestion({ priorities, patch }) {
  const id = useId();
  const answer = petsMovingAnswer(priorities);
  // { message, undo } after a choice on this visit; cleared by Undo.
  const [status, setStatus] = useState(null);

  const choose = (next) => {
    if (next === answer) return;
    // Computed from the latest saved state (the updater runs synchronously),
    // so quick taps never undo against a stale document.
    let result = null;
    patch((current) => { result = setPetsMoving(current, next); return result.priorities; });
    const message = petsChangeMessage(result.priorities, result.change, next) || restingLine(result.priorities) || `Saved: ${PETS_ANSWER_TEXT[next]}.`;
    setStatus({ message, undo: result.undo });
  };
  const undo = () => {
    const { undo: snapshot } = status;
    patch((current) => restorePets(current, snapshot));
    setStatus({ message: 'Undone. Your earlier answer is back.', undo: null });
  };
  const resting = status ? null : restingLine(priorities);
  // What each answer would do now: never promises a change FLH won't make.
  const hints = petsAnswerHints(priorities);

  return (
    <section className="flh-card flh-ob-pf-pets" aria-labelledby={`${id}-q`}>
      <div className="flh-ob-pf-pets-media">
        <FeatureVisual feature={{ art: PETS_QUESTION.art, icon: PETS_QUESTION.icon }} eager />
      </div>
      <fieldset className="flh-ob-pf-pets-fieldset" aria-describedby={`${id}-help`}>
        <legend id={`${id}-q`} className="flh-ob-pf-pets-question">Will pets be moving with you?</legend>
        <p id={`${id}-help`} className="flh-ob-help">Optional. FLH only asks this—no details about your pets.</p>
        <div className="flh-ob-pf-pets-choices">
          {PETS_ANSWERS.map((key) => (
            <label key={key} className={`flh-ob-pf-option flh-ob-pf-pets-choice${answer === key ? ' is-current' : ''}`}>
              <input type="radio" name={`${id}-pets`} value={key} checked={answer === key} onChange={() => choose(key)} aria-label={PETS_ANSWER_TEXT[key]} aria-describedby={`${id}-${key}-hint`} />
              <span className="flh-ob-pf-option-title" aria-hidden="true">{PETS_ANSWER_TEXT[key]}</span>
              <span id={`${id}-${key}-hint`} className="flh-ob-pf-option-hint">{hints[key]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flh-ob-pf-pets-status" role="status" aria-live="polite">
        {status && (
          <div className="flh-ob-switch-note">
            <p>{status.message}</p>
            {status.undo && <button type="button" className="flh-text-action" onClick={undo}>Undo</button>}
          </div>
        )}
        {resting && <p className="flh-ob-help flh-ob-pf-pets-resting">{resting}</p>}
      </div>
    </section>
  );
}
