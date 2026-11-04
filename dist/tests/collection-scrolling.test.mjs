import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeSongScrolling } from '../studio/collection-scrolling.js';

test('the studio list remains keyboard scrollable, shows fades and preserves its position', () => {
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  function createViewport() {
    const collection = { dataset: {} };
    const viewport = {
      clientHeight: 240,
      scrollHeight: 600,
      scrollTop: 0,
      firstElementChild: {},
      closest: () => collection,
      addEventListener: (_event, listener) => {
        viewport.onScroll = listener;
      },
      removeEventListener: () => {
        viewport.onScroll = null;
      },
      querySelector: () => null,
    };
    return { viewport, collection };
  }
  let current = createViewport();
  globalThis.document = { querySelector: () => current?.viewport || null };
  initializeSongScrolling();
  assert.equal(current.viewport.tabIndex, 0);
  assert.equal(current.collection.dataset.scrollBefore, false);
  assert.equal(current.collection.dataset.scrollAfter, true);
  current.viewport.scrollTop = 360;
  current.viewport.onScroll();
  assert.equal(current.collection.dataset.scrollBefore, true);
  assert.equal(current.collection.dataset.scrollAfter, false);
  const old = current;
  current = createViewport();
  initializeSongScrolling();
  assert.equal(old.viewport.onScroll, null);
  assert.equal(observers[0].disconnected, true);
  assert.equal(current.viewport.scrollTop, 360);
  current.viewport.scrollHeight = 200;
  current.viewport.scrollTop = 0;
  observers.at(-1).callback();
  assert.equal(current.viewport.tabIndex, -1);
  assert.equal(current.collection.dataset.scrollBefore, false);
  assert.equal(current.collection.dataset.scrollAfter, false);
  current = null;
  initializeSongScrolling();
  assert.equal(observers.at(-1).disconnected, true);
});
