import test from 'node:test';
import assert from 'node:assert/strict';
import { readDevice, writeDevice } from '../app/device-state.js';
test('device state is isolated by profile and never imports legacy state', () => {
  const values = new Map([
    ['encore-explore-guest', '{"idea":"old"}'],
    ['afterglow-volume', '0.2'],
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(readDevice('volume', 0.7), 0.7);
  writeDevice('song-id', 'one', 'guest');
  writeDevice('song-id', 'two', 'other');
  assert.equal(readDevice('song-id', null, 'guest'), 'one');
  assert.equal(readDevice('song-id', null, 'other'), 'two');
  writeDevice('song-id', null, 'guest');
  assert.equal(readDevice('song-id', null, 'guest'), null);
});
test('disabled or corrupt browser storage does not break profile data loading', () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('Blocked');
    },
    setItem() {
      throw new Error('Blocked');
    },
  };
  assert.equal(readDevice('volume', 0.7), 0.7);
  assert.doesNotThrow(() => writeDevice('volume', 0.3));
  globalThis.localStorage = { getItem: () => '{bad json' };
  assert.equal(readDevice('volume', 0.7), 0.7);
});
