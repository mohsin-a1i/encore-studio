import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeExploreGestures } from '../explore/explore-gestures.js';

function fixture() {
  const handlers = new Map(),
    votes = [];
  const listenerOptions = new Map();
  let busy = false;
  const hint = { textContent: '' };
  const card = {
    style: {},
    dataset: {},
    setPointerCapture() {},
    querySelector: () => hint,
    matches: () => true,
  };
  const target = { closest: (selector) => (selector === '[data-explore-card]' ? card : null) };
  const gestures = initializeExploreGestures(
    {
      addEventListener: (name, handler, options) => {
        handlers.set(name, handler);
        listenerOptions.set(name, options);
      },
    },
    (direction) => votes.push(direction),
    () => busy,
  );
  const pointer = (name, x, y = 0) =>
    handlers.get(name)({ target, clientX: x, clientY: y, pointerId: 1, button: 0 });
  return {
    gestures,
    handlers,
    votes,
    pointer,
    card,
    hint,
    listenerOptions,
    touch(name, x, y = 0, fingers = 1) {
      let prevented = false;
      const point = { clientX: x, clientY: y, identifier: 7 };
      handlers.get(name)({
        target,
        touches: name === 'touchend' ? [] : Array.from({ length: fingers }, () => point),
        changedTouches: [point],
        cancelable: true,
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
    busy: () => {
      busy = true;
    },
  };
}

test('mobile swipes lock horizontally and prevent scrolling even when the finger drifts vertically', async () => {
  const f = fixture();
  assert.equal(f.listenerOptions.get('touchmove').passive, false);
  f.touch('touchstart', 0);
  assert.equal(f.touch('touchmove', 20, 3), true);
  assert.equal(f.touch('touchmove', 90, 140), true);
  f.handlers.get('pointercancel')();
  f.touch('touchend', 90, 140);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.votes, ['right']);
});

test('an automatic skip can animate without submitting a duplicate decision', async () => {
  const f = fixture();
  let finish;
  f.card.animate = () => ({
    finished: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel() {},
  });
  const animation = f.gestures.animateExit('left', f.card);
  assert.equal(f.card.dataset.exiting, 'left');
  assert.deepEqual(f.votes, []);
  finish();
  await animation;
  assert.equal(f.card.dataset.exiting, undefined);
  assert.deepEqual(f.votes, []);
});

test('vertical touch gestures scroll normally and never turn into a swipe', () => {
  const f = fixture();
  f.touch('touchstart', 0);
  assert.equal(f.touch('touchmove', 2, 3), false);
  assert.equal(f.touch('touchmove', 5, 20), false);
  assert.equal(f.touch('touchmove', 100, 40), false);
  f.touch('touchend', 100, 40);
  assert.deepEqual(f.votes, []);
});

test('adding a second finger releases the card for pinch zoom instead of voting', () => {
  const f = fixture();
  f.touch('touchstart', 0);
  f.touch('touchmove', 30, 0);
  f.touch('touchstart', 30, 0, 2);
  assert.equal(f.touch('touchmove', 120, 10, 2), false);
  f.touch('touchend', 120, 10);
  assert.deepEqual(f.votes, []);
  assert.equal(f.card.style.transform, '');
});

test('horizontal pointer swipes save right and skip left, resetting feedback', async () => {
  const f = fixture();
  f.pointer('pointerdown', 0);
  f.pointer('pointermove', 100);
  assert.equal(f.hint.textContent, 'Save to library');
  f.pointer('pointerup', 100);
  await Promise.resolve();
  await Promise.resolve();
  f.pointer('pointerdown', 100);
  f.pointer('pointermove', 0);
  f.pointer('pointerup', 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.votes, ['right', 'left']);
  assert.equal(f.card.style.transform, '');
  assert.equal(f.hint.textContent, '');
});

test('scrolls, small drags, cancellations, and busy states never vote', () => {
  const f = fixture();
  f.pointer('pointerdown', 0);
  f.pointer('pointermove', 20, 100);
  f.pointer('pointerup', 100, 100);
  f.pointer('pointerdown', 0);
  f.pointer('pointerup', 40);
  f.pointer('pointerdown', 0);
  f.pointer('pointermove', 100);
  f.handlers.get('pointercancel')();
  f.pointer('pointerup', 100);
  f.busy();
  f.pointer('pointerdown', 0);
  f.pointer('pointerup', 100);
  assert.deepEqual(f.votes, []);
});

test('focused card arrow keys vote once and ignore key repeats', async () => {
  const f = fixture();
  const key = (value, repeat = false) =>
    f.handlers.get('keydown')({
      target: f.card,
      key: value,
      repeat,
      preventDefault() {},
    });
  key('ArrowLeft');
  await Promise.resolve();
  await Promise.resolve();
  key('ArrowRight');
  key('ArrowRight', true);
  await Promise.resolve();
  await Promise.resolve();
  f.busy();
  key('ArrowLeft');
  assert.deepEqual(f.votes, ['left', 'right']);
});

test('a completed swipe submits immediately and ignores duplicates during its animation', async () => {
  const f = fixture();
  let finish;
  let cancelled = false;
  f.card.animate = () => ({
    finished: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel: () => {
      cancelled = true;
    },
  });
  f.pointer('pointerdown', 0);
  f.pointer('pointermove', 100);
  f.pointer('pointerup', 100);
  assert.equal(f.card.dataset.exiting, 'right');
  assert.deepEqual(f.votes, ['right']);
  f.pointer('pointerdown', 0);
  f.pointer('pointerup', -100);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.votes, ['right']);
  assert.equal(cancelled, true);
  assert.equal(f.card.dataset.exiting, undefined);
});

test('network latency does not keep the deck locked after the exit animation', async () => {
  const handlers = new Map();
  let finishSave;
  let refreshed = false;
  const card = {
    style: {},
    dataset: {},
    setPointerCapture() {},
    querySelector: () => ({ textContent: '' }),
  };
  const target = { closest: (selector) => (selector === '[data-explore-card]' ? card : null) };
  initializeExploreGestures(
    { addEventListener: (name, handler) => handlers.set(name, handler) },
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    () => false,
    () => {
      refreshed = true;
    },
  );
  handlers.get('pointerdown')({ target, clientX: 0, clientY: 0, pointerId: 1, button: 0 });
  handlers.get('pointerup')({ target, clientX: 100, clientY: 0, pointerId: 1 });
  assert.equal(card.dataset.dragging, undefined);
  assert.equal(refreshed, true);
  finishSave();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(card.dataset.dragging, undefined);
  assert.equal(refreshed, true);
});
