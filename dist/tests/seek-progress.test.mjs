import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeekFraction, updateSeekProgress } from '../playback/seek-progress.js';

test('seek glow follows the clamped playback position and handles unknown duration', () => {
  assert.equal(getSeekFraction(25, 100), 0.25);
  assert.equal(getSeekFraction(-2, 100), 0);
  assert.equal(getSeekFraction(120, 100), 1);
  assert.equal(getSeekFraction(10, Infinity), 0);
  assert.equal(getSeekFraction(10, 0), 0);
  let value;
  const input = {
    value: '30',
    max: '120',
    closest: () => ({ style: { setProperty: (_name, next) => (value = next) } }),
  };
  updateSeekProgress(input);
  assert.equal(value, '0.25');
});
