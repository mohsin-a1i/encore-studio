import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeKeyboardVisibility } from '../playback/keyboard-visibility.js';

function fixture(t, touch = true) {
  const attributes = new Set();
  const viewport = Object.assign(new EventTarget(), { height: 800, scale: 1 });
  const media = Object.assign(new EventTarget(), { matches: touch });
  const view = Object.assign(new EventTarget(), {
    innerHeight: 800,
    visualViewport: viewport,
    matchMedia: () => media,
  });
  const doc = Object.assign(new EventTarget(), {
    activeElement: null,
    documentElement: {
      clientHeight: 800,
      toggleAttribute: (key, on) => (on ? attributes.add(key) : attributes.delete(key)),
      removeAttribute: (key) => attributes.delete(key),
    },
  });
  t.after(initializeKeyboardVisibility({ view, doc }));
  return {
    viewport,
    view,
    hidden: () => attributes.has('data-mobile-keyboard'),
    focus() {
      doc.activeElement = { matches: () => true };
      doc.dispatchEvent(new Event('focusin'));
    },
    blur() {
      doc.activeElement = null;
      doc.dispatchEvent(new Event('focusout'));
    },
    resize(height, layoutHeight = 800) {
      viewport.height = height;
      view.innerHeight = layoutHeight;
      doc.documentElement.clientHeight = layoutHeight;
      viewport.dispatchEvent(new Event('resize'));
    },
  };
}

test('mobile keyboard hides controls even when both viewports shrink, and dismissal restores them with the input still focused', (t) => {
  const f = fixture(t);
  f.focus();
  assert.equal(f.hidden(), false);
  f.resize(480, 480);
  assert.equal(f.hidden(), true);
  f.resize(800);
  assert.equal(f.hidden(), false);
});

test('controls stay hidden during keyboard dismissal after blur and between inputs', (t) => {
  const f = fixture(t);
  f.focus();
  f.resize(480);
  f.blur();
  assert.equal(f.hidden(), true);
  f.focus();
  assert.equal(f.hidden(), true);
  f.blur();
  f.resize(800);
  assert.equal(f.hidden(), false);
});

test('browser chrome, pinch zoom and desktop window resizing do not hide the player', (t) => {
  const mobile = fixture(t);
  mobile.focus();
  mobile.resize(720);
  assert.equal(mobile.hidden(), false);
  mobile.viewport.scale = 2;
  mobile.resize(400);
  assert.equal(mobile.hidden(), false);
  const desktop = fixture(t, false);
  desktop.focus();
  desktop.resize(480, 480);
  assert.equal(desktop.hidden(), false);
});
