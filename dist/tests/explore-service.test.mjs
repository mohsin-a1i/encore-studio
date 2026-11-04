import test from 'node:test';
import assert from 'node:assert/strict';
import { openLibraryStore } from '../library/library-store.mjs';
import { librarySnapshot } from '../library/library-snapshot.mjs';
import { stateFixture } from './helpers/state-fixture.mjs';

test('accepting an idea durably reports pending generation before the buffer is filled', async (t) => {
  const f = await stateFixture(t);
  const started = await f.start();
  assert.ok(started.pending > 0);
  assert.equal(started.error, '');
  assert.ok(librarySnapshot(f.store.state, 'guest').explore.pending > 0);
  await f.settle();
  assert.ok(f.explore.snapshot('guest').songId);
});

test('explicitly resubmitting a failed idea resumes generation, keeps ready songs, and remains idempotent', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const before = f.explore.snapshot('guest');
  const failed = f.store.state.songs.find((song) => song.id === before.queueIds[0]);
  failed.error = 'fetch failed';
  await f.store.save();
  await f.settle();
  const input = {
    idea: before.idea,
    revision: f.explore.state('guest').revision,
    commandId: 'resume-failed-idea',
  };
  const resumed = await f.explore.start('guest', input);
  assert.equal(resumed.sessionId, before.sessionId);
  assert.equal(resumed.error, '');
  assert.ok(resumed.pending > 0);
  assert.equal(resumed.queueIds.includes(failed.id), false);
  assert.deepEqual(
    resumed.queueIds,
    before.queueIds.filter((id) => id !== failed.id),
  );
  await f.explore.start('guest', input);
  await f.settle();
  assert.equal(f.explore.snapshot('guest').queueIds.length, 6);
  assert.equal(f.store.state.songs.filter((song) => song.temporary).length, 6);
});

test('two devices share one durable idea, deck and six-song buffer', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const a = librarySnapshot(f.store.state, 'guest');
  const b = librarySnapshot(f.store.state, 'guest');
  assert.deepEqual(a.explore, b.explore);
  assert.equal(a.explore.queueIds.length, 6);
  assert.equal(a.songs.length, 0);
  assert.equal(librarySnapshot(f.store.state, 'other').explore.sessionId, null);
  await f.explore.start('guest', {
    idea: 'Road trip',
    revision: 0,
    commandId: 'start-1',
  });
  await f.settle();
  assert.equal(f.store.state.songs.length, 6);
  f.explore.close();
  const reopened = await openLibraryStore(f.root);
  assert.deepEqual(librarySnapshot(reopened.state, 'guest').explore, a.explore);
});
test('concurrent decisions advance only once and keep the same song entity', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const view = f.explore.snapshot('guest');
  const input = {
    sessionId: view.sessionId,
    songId: view.songId,
    decision: 'keep',
  };
  await Promise.all([f.explore.decide('guest', input), f.explore.decide('guest', input)]);
  assert.equal(f.store.state.songs.filter((s) => !s.temporary).length, 1);
  assert.equal(f.store.state.songs.find((s) => s.id === input.songId).temporary, undefined);
  await assert.rejects(f.explore.decide('guest', { ...input, decision: 'skip' }), { status: 409 });
  await f.settle();
  assert.equal(f.explore.snapshot('guest').queueIds.length, 6);
});
test('a stale device cannot replace an idea or consume a different session', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const old = f.explore.snapshot('guest');
  await assert.rejects(
    f.explore.start('guest', {
      idea: 'Wrong',
      revision: 0,
      commandId: 'other-command',
    }),
    { status: 409 },
  );
  await f.start('guest', 'New idea', 'start-2');
  await assert.rejects(
    f.explore.decide('guest', {
      sessionId: old.sessionId,
      songId: old.songId,
      decision: 'keep',
    }),
    { status: 409 },
  );
  assert.equal(f.explore.snapshot('guest').idea, 'New idea');
});
test('skip advances immediately but temporary audio cleanup waits for another device', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const view = f.explore.snapshot('guest');
  let now = 0;
  f.songs.mediaUse.now = () => now;
  f.songs.mediaUse.touch('guest', 'listening-device', view.songId);
  await f.explore.decide('guest', {
    sessionId: view.sessionId,
    songId: view.songId,
    decision: 'skip',
  });
  await f.settle();
  assert.ok(f.store.state.songs.some((s) => s.id === view.songId));
  assert.ok(!f.explore.snapshot('guest').queueIds.includes(view.songId));
  now = 66000;
  await f.settle();
  assert.ok(!f.store.state.songs.some((s) => s.id === view.songId));
  assert.ok(f.store.state.deletedSongIds.includes(view.songId));
});
test('profiles and legacy temporary records stay intact until explicitly handled', async (t) => {
  const f = await stateFixture(t);
  await f.songs.create(
    'Legacy idea',
    'legacy',
    '',
    { kind: 'explore', exploreSession: 'old' },
    'guest',
  );
  await f.settle();
  assert.equal(f.explore.snapshot('guest').sessionId, null);
  assert.equal(f.store.state.songs.length, 1);
  await f.start('other');
  await f.settle();
  assert.equal(f.explore.snapshot('guest').sessionId, null);
  assert.equal(f.store.state.songs.filter((s) => s.profileId === 'other').length, 6);
});
test('restarted reservations reuse their request and a deleted request cannot recreate a song', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const state = f.explore.state('guest'),
    existing = f.store.state.songs[0];
  state.queueIds = state.queueIds.filter((id) => id !== existing.id);
  state.reservations.push(existing.requestId);
  await f.settle();
  assert.equal(f.store.state.songs.length, 6);
  await f.songs.delete(existing.id, existing.id);
  await assert.rejects(f.songs.create('Old input', existing.requestId, '', { kind: 'draft' }), {
    status: 410,
  });
});
test('failed jobs remain visible and are replaced only by explicit retry', async (t) => {
  const f = await stateFixture(t);
  await f.start();
  await f.settle();
  const song = f.store.state.songs[0];
  delete song.audioFile;
  song.error = 'Interrupted';
  await f.store.save();
  await f.settle();
  assert.match(f.explore.snapshot('guest').error, /Interrupted/);
  assert.equal(f.store.state.songs.length, 6);
  const current = f.explore.snapshot('guest');
  await f.explore.retry('guest', current);
  await f.settle();
  assert.equal(f.explore.snapshot('guest').error, '');
  assert.ok(f.store.state.deletedSongIds.includes(song.id));
});

test('a failed state commit cannot expose an unacknowledged idea or start generation', async (t) => {
  const f = await stateFixture(t);
  const original = f.store.save;
  let fail = true;
  f.store.save = async () => {
    if (fail) throw new Error('Disk unavailable');
    return original();
  };
  await assert.rejects(f.start(), /Disk unavailable/);
  assert.equal(f.explore.snapshot('guest').sessionId, null);
  assert.equal(f.store.state.songs.length, 0);
  fail = false;
  await f.start();
  await f.settle();
  assert.equal(f.explore.snapshot('guest').queueIds.length, 6);
});
