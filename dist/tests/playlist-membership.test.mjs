import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlaylistMembership } from '../library/playlist-membership.js';

test('adding a membership preserves the other songs', async () => {
  const playlist = { id: 'p1', songIds: ['other-song'] };
  const updated = { ...playlist, songIds: ['other-song', 'song-1'] };
  const calls = [];
  const result = await updatePlaylistMembership(
    async (...args) => {
      calls.push(args);
      return updated;
    },
    playlist,
    'song-1',
    true,
  );
  assert.deepEqual(calls, [
    ['playlists/p1', { method: 'PATCH', body: JSON.stringify({ addSongIds: ['song-1'] }) }],
  ]);
  assert.deepEqual(result, updated);
  assert.deepEqual(playlist.songIds, ['other-song']);
});

test('removing membership uses the playlist endpoint and never deletes the song', async () => {
  const playlist = { id: 'p1', songIds: ['song-1', 'other-song'] };
  const calls = [];
  const result = await updatePlaylistMembership(
    async (...args) => calls.push(args),
    playlist,
    'song-1',
    false,
  );
  assert.deepEqual(calls, [['playlists/p1/songs/song-1', { method: 'DELETE' }]]);
  assert.deepEqual(result.songIds, ['other-song']);
  assert.deepEqual(playlist.songIds, ['song-1', 'other-song']);
});

test('failed membership changes leave the current playlist intact', async () => {
  const playlist = { id: 'p1', songIds: ['song-1'] };
  await assert.rejects(
    updatePlaylistMembership(
      async () => {
        throw new Error('Offline');
      },
      playlist,
      'song-1',
      false,
    ),
    /Offline/,
  );
  assert.deepEqual(playlist.songIds, ['song-1']);
});

test('unchanged membership requires no request', async () => {
  const playlist = { id: 'p1', songIds: ['song-1'] };
  const requestStudio = () => {
    throw new Error('Unexpected request');
  };
  assert.equal(await updatePlaylistMembership(requestStudio, playlist, 'song-1', true), playlist);
  assert.equal(
    await updatePlaylistMembership(requestStudio, playlist, 'other-song', false),
    playlist,
  );
});
