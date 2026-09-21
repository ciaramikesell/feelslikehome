// Real-DOM behavioral regression coverage for the Sheet focus-trap bug:
// typing into a controlled input inside a Sheet must never lose focus after
// a single character. This project's other tests are plain source-string
// assertions (no JSX transform is configured for `node --test`), which is
// exactly why this class of bug went unnoticed — a regex can't observe an
// actual keystroke. This file renders real React components (built with
// React.createElement, not JSX, so no transform is needed) against a real
// jsdom document and dispatches genuine input events, exactly reproducing
// the user-observed symptom.
//
// IMPORTANT: never pass a raw DOM node to assert.equal/notEqual. On failure,
// Node's assert module runs util.inspect on both operands to build a diff,
// and a jsdom node's object graph (ownerDocument -> defaultView -> window ->
// every global, including this very document) makes that inspection take
// effectively forever. Always compare a boolean (`a === b`) instead, so a
// failed assertion reports instantly instead of hanging the test run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
// Node 22 defines a built-in read-only `global.navigator`; override it.
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState, useRef, act } = React;
const { createRoot } = await import('react-dom/client');
const { useSheetFocusTrap } = await import('../src/lib/useSheetFocusTrap.js');

const h = React.createElement;
const isFocused = (node) => document.activeElement === node;

// A faithful, minimal stand-in for Sheet.jsx's own render shape (header X
// button rendered before the body, exactly like the real component), driven
// entirely by useSheetFocusTrap — the actual hook Sheet.jsx now calls.
function TestSheet({ open, onClose, dialogRef, children }) {
  useSheetFocusTrap(open, onClose, dialogRef);
  if (!open) return null;
  return h('div', { ref: dialogRef, tabIndex: -1, role: 'dialog' },
    h('div', null, h('button', { type: 'button', onClick: onClose, 'aria-label': 'Close' }, 'X')),
    h('div', null, children),
  );
}

// Reproduces the exact real-world bug pattern: CommuteDestinations/
// InviteCoBuyer both define their close/cancel handler inline in the
// component body (no useCallback), so it gets a new identity on every
// re-render — including the re-render every keystroke causes via setState.
function Harness({ inputRef }) {
  const [open, setOpen] = useState(true);
  const [label, setLabel] = useState('');
  const dialogRef = useRef(null);
  const cancel = () => setOpen(false); // new function identity every render, on purpose
  return h(TestSheet, { open, onClose: cancel, dialogRef },
    h('input', {
      ref: inputRef,
      'aria-label': 'place label',
      value: label,
      onChange: (event) => setLabel(event.target.value),
    }),
  );
}

function typeChar(input, nextValue) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, nextValue);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  return { container, root };
}

test('typing continuously into a Places-That-Matter-style input never loses focus (reproduces the real user symptom)', () => {
  const inputRef = { current: null };
  const { container, root } = mount(h(Harness, { inputRef }));
  try {
    const input = inputRef.current;
    assert.ok(input, 'input should have rendered');
    act(() => { input.focus(); });
    assert.equal(isFocused(input), true);

    const word = "Mom's House";
    let typed = '';
    for (const char of word) {
      typed += char;
      act(() => { typeChar(input, typed); });
      assert.equal(isFocused(input), true, `focus should remain on the input after typing "${typed}"`);
    }
    assert.equal(input.value, word);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

test('the invitation-modal scenario (InviteCoBuyer\'s email input) also retains focus while typing — the shared-primitive fix protects both', () => {
  // InviteCoBuyer.jsx defines `close` the same way CommuteDestinations
  // defines `cancel`: a plain arrow function in the component body, not
  // wrapped in useCallback, so it gets a new identity on every keystroke's
  // re-render. This is the exact prior invitation-modal regression pattern —
  // proving it here (via the real shared hook) guards against reintroducing
  // it while fixing Places That Matter.
  function InviteHarness({ inputRef }) {
    const [open, setOpen] = useState(true);
    const [email, setEmail] = useState('');
    const dialogRef = useRef(null);
    const close = () => setOpen(false); // new identity every render, exactly like InviteCoBuyer's `close`
    return h(TestSheet, { open, onClose: close, dialogRef },
      h('input', {
        ref: inputRef, type: 'email', 'aria-label': 'Collaborator email',
        value: email, onChange: (event) => setEmail(event.target.value),
      }),
    );
  }
  const inputRef = { current: null };
  const { container, root } = mount(h(InviteHarness, { inputRef }));
  try {
    const input = inputRef.current;
    act(() => { input.focus(); });
    let typed = '';
    for (const char of 'their@email.com') {
      typed += char;
      act(() => { typeChar(input, typed); });
      assert.equal(isFocused(input), true, `invitation email input should keep focus after typing "${typed}"`);
    }
    assert.equal(input.value, 'their@email.com');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

test('backspace/editing after continuous typing also keeps focus on the input', () => {
  const inputRef = { current: null };
  const { container, root } = mount(h(Harness, { inputRef }));
  try {
    const input = inputRef.current;
    act(() => { input.focus(); });
    for (const value of ['1', '12', '123 Main St']) act(() => { typeChar(input, value); });
    assert.equal(isFocused(input), true);
    // Backspace/edit: shorten the value the same way typing lengthens it.
    for (const value of ['123 Main S', '123 Main ', '123 Main']) {
      act(() => { typeChar(input, value); });
      assert.equal(isFocused(input), true);
    }
    assert.equal(input.value, '123 Main');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

test('the X button still closes the sheet, and Escape still closes it', () => {
  const inputRef = { current: null };
  function ObservableHarness({ inputRef, onCloseSpy }) {
    const [open, setOpen] = useState(true);
    const dialogRef = useRef(null);
    const cancel = () => { setOpen(false); onCloseSpy(); };
    return h(TestSheet, { open, onClose: cancel, dialogRef }, h('input', { ref: inputRef, 'aria-label': 'x' }));
  }
  let closed = 0;
  const { container, root } = mount(h(ObservableHarness, { inputRef, onCloseSpy: () => { closed += 1; } }));
  try {
    const closeButton = container.querySelector('button[aria-label="Close"]');
    assert.ok(closeButton);
    act(() => { closeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(closed, 1);
    assert.equal(container.querySelector('[role="dialog"]') === null, true, 'sheet should be gone after close');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

test('Escape dismisses the sheet via the latest onClose, even though it is read through a ref', () => {
  function EscapeHarness({ onCloseSpy }) {
    const [open, setOpen] = useState(true);
    const dialogRef = useRef(null);
    const cancel = () => { setOpen(false); onCloseSpy(); };
    return h(TestSheet, { open, onClose: cancel, dialogRef }, h('input', { 'aria-label': 'x' }));
  }
  let closed = 0;
  const { container, root } = mount(h(EscapeHarness, { onCloseSpy: () => { closed += 1; } }));
  try {
    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(closed, 1);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

test('proof: this test suite actually catches the regression — reverting to the old [open, onClose] dependency fails it', () => {
  // This does not modify any source file; it independently re-implements
  // the previously-broken effect body against the same harness shape, so
  // the assertions above are proven meaningful rather than trivially passing.
  const { useEffect, useRef: useRefLocal } = React;

  function brokenHook(open, onClose, dialogRef) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (!open) return undefined;
      const node = dialogRef.current;
      const focusable = () => node ? Array.from(node.querySelectorAll('button, input')) : [];
      (focusable()[0] || node)?.focus();
      return undefined;
      // The proven-bad dependency array: reruns on every onClose identity change.
    }, [open, onClose]);
  }

  function BrokenTestSheet({ open, onClose, dialogRef, children }) {
    brokenHook(open, onClose, dialogRef);
    if (!open) return null;
    return h('div', { ref: dialogRef, tabIndex: -1, role: 'dialog' },
      h('div', null, h('button', { type: 'button', onClick: onClose, 'aria-label': 'Close' }, 'X')),
      h('div', null, children),
    );
  }

  function BrokenHarness({ inputRef }) {
    const [open] = useState(true);
    const [label, setLabel] = useState('');
    const dialogRef = useRefLocal(null);
    const cancel = () => {}; // new identity every render, same as the real bug
    return h(BrokenTestSheet, { open, onClose: cancel, dialogRef },
      h('input', { ref: inputRef, 'aria-label': 'place label', value: label, onChange: (e) => setLabel(e.target.value) }),
    );
  }

  const inputRef = { current: null };
  const { container, root } = mount(h(BrokenHarness, { inputRef }));
  try {
    const input = inputRef.current;
    act(() => { input.focus(); });
    act(() => { typeChar(input, 'M'); });
    assert.equal(isFocused(input), false, 'the broken [open, onClose] dependency should reproduce the focus-loss bug after one character');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});
