import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDeck, animateDeck } from '../explore/deck-motion.js';

test('all surviving cards animate from their former position and size across a deck rebuild', (t) => {
  const oldStyle = globalThis.getComputedStyle,
    oldMatrix = globalThis.DOMMatrixReadOnly;
  globalThis.getComputedStyle = () => ({ transform: 'none' });
  globalThis.DOMMatrixReadOnly = class {
    e = 0;
    f = 0;
  };
  t.after(() => {
    globalThis.getComputedStyle = oldStyle;
    globalThis.DOMMatrixReadOnly = oldMatrix;
  });
  const motions = [];
  const card = (key, x, y, width, height) => ({
    dataset: { deckKey: key },
    offsetWidth: width,
    offsetHeight: height,
    getBoundingClientRect: () => ({ left: x, top: y, width, height }),
    animate: (frames) => motions.push({ key, frames }),
  });
  let elements = [
    card('next', 20, 0, 400, 600),
    card('third', -20, -20, 400, 600),
    card('preparing', 40, -30, 400, 600),
  ];
  const root = { querySelectorAll: () => elements };
  const previous = captureDeck(root);
  elements = [
    card('next', 0, 20, 400, 620),
    card('third', 20, 0, 400, 620),
    card('preparing', -20, -20, 400, 620),
  ];
  animateDeck(root, previous);
  assert.deepEqual(
    motions.map((motion) => motion.key),
    ['next', 'third', 'preparing'],
  );
  for (const motion of motions) {
    assert.match(motion.frames[0].transform, /translate\(.+\) .*scale\(/);
    assert.equal(motion.frames[1].transform, 'none');
  }
});
