import test from 'node:test';
import assert from 'node:assert/strict';
import { createExploreController } from '../explore/explore-controller.js';
import { getExploreSong } from '../explore/explore-session.js';
function fixture(requestStudio = async () => {}, options = {}) {
  const state = {
    connected: true,
    profileId: 'guest',
    currentId: null,
    explore: { revision: 4, sessionId: 's', songId: 'one', queueIds: ['one'] },
    exploreSongs: [{ id: 'one', audio: 'one.mp3' }],
  };
  const calls = [],
    played = [],
    messages = [];
  const controller = createExploreController({
    state,
    audio: { pause() {}, removeAttribute() {}, load() {} },
    requestStudio: async (...args) => {
      calls.push(args);
      return requestStudio(...args);
    },
    render() {},
    startSong: async (id) => {
      state.currentId = id;
      played.push(id);
    },
    notify: (message) => messages.push(message),
    createId: () => 'command-1',
    ...options,
  });
  return { state, calls, played, messages, controller };
}
test('opening, syncing and reconnecting do not generate or play songs', () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.controller.sync();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.played, []);
});

test('automatic skips advance despite suspended animation or a disconnected event stream without clearing ready audio', async () => {
  for (const connected of [true, false]) {
    let resolve;
    let animations = 0;
    let releases = 0;
    const f = fixture(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
      {
        onAutoSkip: () => {
          animations++;
          return new Promise(() => {});
        },
        audio: {
          pause() {
            releases++;
          },
          removeAttribute() {
            releases++;
          },
          load() {
            releases++;
          },
        },
      },
    );
    f.state.currentId = 'one';
    f.state.connected = connected;
    f.state.explore.queueIds = ['one', 'two'];
    f.state.exploreSongs.push({ id: 'two', audio: 'two.mp3' });
    assert.equal(f.controller.advance(), true);
    assert.equal(f.state.currentId, 'two');
    assert.equal(animations, 1);
    assert.equal(releases, 0);
    resolve({ revision: 5, sessionId: 's', songId: 'two', queueIds: ['two'] });
    await new Promise(setImmediate);
  }
});
test('Explore commands carry the profile and session/revision instead of a browser queue', async () => {
  const f = fixture(async (_route, options) => ({
    ...f.state.explore,
    revision: 5,
    idea: JSON.parse(options.body).idea,
  }));
  await f.controller.start('New idea');
  assert.equal(f.calls[0][0], 'explore/start');
  assert.equal(f.calls[0][1].headers['X-Profile-Id'], 'guest');
  assert.deepEqual(JSON.parse(f.calls[0][1].body), {
    idea: 'New idea',
    revision: 4,
    commandId: 'command-1',
  });
});
test('late replies cannot overwrite another profile or a newer snapshot', async () => {
  let release;
  const response = new Promise((resolve) => (release = resolve));
  const f = fixture(() => response);
  const command = f.controller.start('Idea');
  f.state.profileId = 'other';
  f.state.explore = { revision: 20, sessionId: 'other' };
  release({ revision: 5, sessionId: 'old', idea: 'Idea' });
  await command;
  assert.equal(f.state.explore.sessionId, 'other');
});
test('a failed decision leaves playback and the shared card intact', async () => {
  const f = fixture(async () => {
    throw new Error('Offline');
  });
  f.state.currentId = 'one';
  await f.controller.vote('left');
  assert.equal(f.state.currentId, 'one');
  assert.equal(f.state.explore.songId, 'one');
  assert.deepEqual(f.messages, []);
});

test('rapid decisions advance immediately, survive old snapshots, and save in order', async () => {
  const releases = [];
  const f = fixture(() => new Promise((resolve) => releases.push(resolve)));
  f.state.explore.queueIds = ['one', 'two', 'three'];
  f.state.exploreSongs = f.state.explore.queueIds.map((id) => ({ id, audio: id + '.mp3' }));
  f.state.currentId = 'one';
  const first = f.controller.vote('left');
  assert.equal(getExploreSong(f.state).id, 'two');
  assert.equal(f.state.currentId, 'two');
  const second = f.controller.vote('right');
  assert.equal(getExploreSong(f.state).id, 'three');
  assert.equal(f.state.currentId, 'three');
  assert.equal(f.calls.length, 1);
  f.state.explore = {
    revision: 4,
    sessionId: 's',
    songId: 'one',
    queueIds: ['one', 'two', 'three'],
  };
  f.controller.sync();
  assert.equal(getExploreSong(f.state).id, 'three');
  releases[0]({ revision: 5, sessionId: 's', songId: 'two', queueIds: ['two', 'three'] });
  await first;
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1][1].body).songId, 'two');
  releases[1]({ revision: 6, sessionId: 's', songId: 'three', queueIds: ['three'] });
  await second;
  assert.equal(getExploreSong(f.state).id, 'three');
  assert.equal(f.state.exploreDecisions.length, 0);
});

test('failed optimistic writes restore the deck without taking over a library song', async () => {
  let fail;
  const f = fixture(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  f.state.explore.queueIds = ['one', 'two'];
  f.state.exploreSongs.push({ id: 'two', audio: 'two.mp3' });
  f.state.currentId = 'one';
  const decision = f.controller.vote('left');
  assert.equal(getExploreSong(f.state).id, 'two');
  f.state.currentId = 'library-song';
  fail(new Error('Offline'));
  await decision;
  assert.equal(getExploreSong(f.state).id, 'one');
  assert.equal(f.state.currentId, 'library-song');
});
