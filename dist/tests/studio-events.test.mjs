import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLibraryStore } from '../library/library-store.mjs';
import { studioEvents } from '../server/studio-events.mjs';

test('durable changes push scoped snapshots, deduplicate unrelated changes and unsubscribe on close', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-events-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLibraryStore(root);
  const messages = [];
  const response = Object.assign(new EventEmitter(), {
    writeHead(status, headers) {
      assert.equal(status, 200);
      assert.equal(headers['Content-Type'], 'text/event-stream');
    },
    write(message) {
      messages.push(JSON.parse(message.slice(6)));
      return true;
    },
  });
  studioEvents({ request: { method: 'GET' }, response, store, profileId: 'guest' });
  assert.equal(messages.length, 1);
  store.state.songs.push({
    id: 'other',
    profileId: 'another',
    genres: [],
    status: 'draft',
    requests: [],
    renderIds: [],
  });
  await store.save();
  assert.equal(messages.length, 1);
  store.state.songs.push({
    id: 'candidate',
    profileId: 'guest',
    temporary: true,
    exploreSession: 'session',
    genres: [],
    status: 'draft',
    requests: [],
    renderIds: [],
  });
  await store.save();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].exploreSongs[0].id, 'candidate');
  assert.deepEqual(messages[1].songs, []);
  response.emit('close');
  store.state.songs[1].title = 'Finished title';
  await store.save();
  assert.equal(messages.length, 2);
});

test('backpressure coalesces updates and skips stale revisions after initial synchronization', () => {
  const state = {
    profiles: [{ id: 'guest' }],
    songs: [],
    playlists: [],
    deletedSongIds: [],
    deletedSongProfiles: {},
  };
  let listener;
  const messages = [];
  let ready = false;
  const response = Object.assign(new EventEmitter(), {
    writeHead() {},
    write(message) {
      messages.push(message);
      return ready;
    },
  });
  studioEvents({
    request: { method: 'GET' },
    response,
    profileId: 'guest',
    store: {
      state,
      revision: 2,
      subscribe(callback) {
        listener = callback;
        return () => {};
      },
    },
  });
  listener({ ...state, profiles: [{ id: 'guest', name: 'Stale' }] }, 1);
  listener({ ...state, profiles: [{ id: 'guest', name: 'Intermediate' }] }, 3);
  listener({ ...state, profiles: [{ id: 'guest', name: 'Latest' }] }, 4);
  assert.equal(messages.length, 1);
  ready = true;
  response.emit('drain');
  assert.equal(messages.length, 2);
  assert.match(messages[1], /Latest/);
});
