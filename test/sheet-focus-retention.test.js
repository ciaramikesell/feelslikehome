import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/jsdomEnv.mjs';
import { importJsx } from './helpers/importJsx.mjs';

const React = (await import('react')).default;
const { render, cleanup, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { default: Sheet } = await importJsx('src/components/Sheet.jsx');

// Reproduces exactly the shape that broke: a real host component (like
// InviteCoBuyer) whose email/relationship state lives ABOVE Sheet, passed
// down as an inline onClose recreated every render — the same pattern any
// Sheet caller reasonably writes. Before the fix, Sheet's focus-management
// effect depended on [open, onClose], so every keystroke (a new onClose
// reference) re-ran it and stole focus back to the first focusable element
// (the close button) — exactly the "type one character, focus jumps to X"
// regression. This harness renders the real Sheet.jsx, not a
// reimplementation of it.
function HostWithUnstableOnClose() {
  const [email, setEmail] = React.useState('');
  const [relationship, setRelationship] = React.useState('co_buyer');
  return React.createElement(
    Sheet,
    { open: true, onClose: () => {}, title: 'Invite a collaborator', size: 'default' },
    React.createElement('input', {
      key: 'email',
      'aria-label': 'Collaborator email',
      type: 'email',
      value: email,
      onChange: (e) => setEmail(e.target.value),
    }),
    React.createElement('input', {
      key: 'co_buyer',
      type: 'radio',
      name: 'relationship',
      'aria-label': 'Co-buyer',
      value: 'co_buyer',
      checked: relationship === 'co_buyer',
      onChange: (e) => setRelationship(e.target.value),
    }),
    React.createElement('input', {
      key: 'realtor',
      type: 'radio',
      name: 'relationship',
      'aria-label': 'Realtor',
      value: 'realtor',
      checked: relationship === 'realtor',
      onChange: (e) => setRelationship(e.target.value),
    }),
  );
}

test.afterEach(() => cleanup());

test('typing a full email address character-by-character keeps focus in the email input the entire time (regression for the focus-jumps-to-close-button bug)', async () => {
  const user = userEvent.setup();
  render(React.createElement(HostWithUnstableOnClose));

  const emailInput = screen.getByLabelText('Collaborator email');
  await user.click(emailInput);
  assert.equal(document.activeElement, emailInput, 'input should be focused after click');

  await user.type(emailInput, 'andrew@example.com');

  assert.equal(emailInput.value, 'andrew@example.com');
  assert.equal(document.activeElement, emailInput, 'focus must still be on the email input after typing every character, not the close button');
});

test('selecting Co-buyer vs Realtor (a sibling state change re-rendering the host) does not steal focus away from the email input either', async () => {
  const user = userEvent.setup();
  render(React.createElement(HostWithUnstableOnClose));

  const emailInput = screen.getByLabelText('Collaborator email');
  await user.click(emailInput);
  await user.type(emailInput, 'an');

  const realtorRadio = screen.getByLabelText('Realtor');
  await user.click(realtorRadio);
  assert.equal(document.activeElement, realtorRadio, 'clicking the radio should focus the radio itself');

  await user.click(emailInput);
  await user.type(emailInput, 'drew@example.com');
  assert.equal(emailInput.value, 'andrew@example.com');
  assert.equal(document.activeElement, emailInput, 'focus must remain on the email input while typing, regardless of the relationship selection');
});

test('Escape still closes the dialog (focus-trap behavior is not broken by removing onClose from the effect dependency list)', async () => {
  const user = userEvent.setup();
  let closed = false;
  function HostWithCloseTracking() {
    return React.createElement(
      Sheet,
      { open: true, onClose: () => { closed = true; }, title: 'Test', size: 'default' },
      React.createElement('input', { key: 'email', 'aria-label': 'Collaborator email', type: 'email' }),
    );
  }
  render(React.createElement(HostWithCloseTracking));
  await user.keyboard('{Escape}');
  assert.equal(closed, true, 'Escape should still call the current onClose');
});
