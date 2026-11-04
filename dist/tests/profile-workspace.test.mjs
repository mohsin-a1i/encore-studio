import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, updatePreferences } from '../profiles/profile-workspace.mjs';
import { openLibraryStore } from '../library/library-store.mjs';
import { stateFixture } from './helpers/state-fixture.mjs';
test('preferences persist across restart and stay scoped to their profile', async (t) => {
  const f = await stateFixture(t),
    profile = f.store.state.profiles[0];
  updatePreferences(profile, {
    changes: { theme: 'blue-nocturne' },
    base: { theme: 'magic' },
  });
  await f.store.save();
  const revision = f.store.revision;
  const reopened = await openLibraryStore(f.root);
  assert.equal(workspace(reopened.state.profiles[0]).preferences.theme, 'blue-nocturne');
  assert.equal(workspace(reopened.state.profiles[1]).preferences.theme, 'magic');
  assert.ok(reopened.revision > revision);
});
test('unrelated settings merge while stale edits to the same field conflict', () => {
  const profile = { id: 'guest' };
  updatePreferences(profile, {
    changes: { theme: 'copper-glow' },
    base: { theme: 'magic' },
  });
  updatePreferences(profile, {
    changes: { editorSections: { song: { lyrics: false } } },
    base: { editorSections: {} },
  });
  updatePreferences(profile, {
    changes: { editorSections: { song: { style: false } } },
    base: { editorSections: {} },
  });
  assert.deepEqual(workspace(profile).preferences.editorSections, {
    song: { lyrics: false, style: false },
  });
  assert.throws(
    () =>
      updatePreferences(profile, {
        changes: { theme: 'blue-nocturne' },
        base: { theme: 'magic' },
      }),
    { status: 409 },
  );
  assert.throws(
    () =>
      updatePreferences(profile, {
        changes: { theme: 'unknown' },
        base: { theme: 'copper-glow' },
      }),
    { status: 400 },
  );
});
test('stale song edits conflict and deleting a song cannot be undone by an old create request', async (t) => {
  const f = await stateFixture(t);
  const song = await f.songs.create('', 'draft', '', {
    kind: 'draft',
    lyrics: 'First',
  });
  await f.songs.update(song.id, { lyrics: 'Device one', baseRevision: 0 });
  await assert.rejects(f.songs.update(song.id, { lyrics: 'Device two', baseRevision: 0 }), {
    status: 409,
  });
  assert.equal(f.songs.get(song.id).lyrics, 'Device one');
  await f.songs.delete(song.id, song.id);
  await assert.rejects(f.songs.create('', 'draft', '', { kind: 'draft', lyrics: 'Old recovery' }), {
    status: 410,
  });
});

test('parallel playlist additions preserve both devices and stale replacements fail', async (t) => {
  const f = await stateFixture(t);
  const { libraryRoutes } = await import('../library/library-routes.mjs');
  const { Readable } = await import('node:stream');
  const a = await f.songs.create('', 'one', '', { kind: 'draft' }),
    b = await f.songs.create('', 'two', '', { kind: 'draft' });
  a.audioFile = 'one.mp3';
  b.audioFile = 'two.mp3';
  f.store.state.playlists.push({
    id: 'p',
    profileId: 'guest',
    songIds: [],
    name: 'Mix',
  });
  async function patch(input) {
    const request = Readable.from([Buffer.from(JSON.stringify(input))]);
    request.method = 'PATCH';
    request.headers = {};
    const response = { writeHead() {}, end() {} };
    return libraryRoutes({
      request,
      response,
      routeSegments: ['api', 'playlists', 'p'],
      store: f.store,
      songs: f.songs,
      dataRoot: f.root,
      profileId: 'guest',
    });
  }
  await Promise.all([patch({ addSongIds: [a.id] }), patch({ addSongIds: [b.id] })]);
  assert.deepEqual(new Set(f.store.state.playlists[0].songIds), new Set([a.id, b.id]));
  await assert.rejects(patch({ songIds: [a.id], baseRevision: 0 }), {
    status: 409,
  });
});
