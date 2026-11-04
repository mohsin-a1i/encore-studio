import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStudioSongGroup,
  filterStudioSongs,
  countStudioSongs,
  studioSongGroups,
} from '../studio/song-collection.js';
import { songStatuses, normalizeSongStatus, isSongGenerating } from '../songs/song-status.js';

const songs = [
  {
    id: 'a',
    title: 'Café moon',
    status: 'ready',
    audio: 'a.mp3',
    lyrics: 'A lucky chorus',
    updatedAt: '2026-10-20',
  },
  {
    id: 'b',
    title: 'New song',
    status: 'lyrics',
    sampleTitle: 'An Urdu reference',
    updatedAt: '2026-10-21',
  },
  {
    id: 'c',
    title: 'Almost',
    status: 'draft',
    style: 'Orchestral rock',
    lyrics: 'A chorus',
    updatedAt: '2026-10-22',
  },
  {
    id: 'd',
    title: 'Try again',
    status: 'ready',
    job: { kind: 'lyrics', outcome: 'failed' },
    audio: 'old.mp3',
  },
  { id: 'e', title: 'A spark', status: 'draft' },
];

test('every song belongs to the filter with exactly its stored status', () => {
  assert.deepEqual(songs.map(getStudioSongGroup), ['ready', 'lyrics', 'draft', 'ready', 'draft']);
  for (const status of songStatuses) {
    const group = filterStudioSongs(songs, '', status.id);
    assert.ok(group.every((song) => song.status === status.id));
  }
  assert.deepEqual(countStudioSongs(songs), { all: 5, draft: 2, lyrics: 1, audio: 0, ready: 2 });
});
test('studio search finds title, reference, style and lyrics with multiple words and accent folding', () => {
  assert.deepEqual(
    filterStudioSongs(songs, 'CAFE lucky').map((s) => s.id),
    ['a'],
  );
  assert.deepEqual(
    filterStudioSongs(songs, 'urdu').map((s) => s.id),
    ['b'],
  );
  assert.deepEqual(
    filterStudioSongs(songs, 'rock').map((s) => s.id),
    ['c'],
  );
  assert.deepEqual(filterStudioSongs(songs, 'no match'), []);
  assert.deepEqual(
    filterStudioSongs([{ id: 'u', lyrics: 'میرا دل' }], 'دل').map((s) => s.id),
    ['u'],
  );
});

test('studio search and status filters combine and sorting never mutates the library', () => {
  const before = songs.map((s) => s.id);
  assert.deepEqual(
    filterStudioSongs(songs, '', 'ready').map((s) => s.id),
    ['a', 'd'],
  );
  assert.deepEqual(filterStudioSongs(songs, 'moon', 'audio'), []);
  assert.deepEqual(
    filterStudioSongs(songs).map((s) => s.id),
    ['c', 'b', 'a', 'd', 'e'],
  );
  assert.deepEqual(
    songs.map((s) => s.id),
    before,
  );
});

test('the filter list is the same four statuses used by the backend', () => {
  assert.deepEqual(
    songStatuses.map((status) => status.id),
    ['draft', 'lyrics', 'audio', 'ready'],
  );
  assert.deepEqual(
    songStatuses.map((status) => status.label),
    ['Draft', 'Auto completing', 'Composing Song', 'Ready to play'],
  );
  assert.equal(studioSongGroups, songStatuses);
  assert.equal(isSongGenerating({ status: 'lyrics' }), true);
  assert.equal(isSongGenerating({ status: 'audio' }), true);
  assert.equal(isSongGenerating({ status: 'draft' }), false);
});

test('legacy statuses migrate to a supported song status and job progress stays separate', () => {
  for (const status of ['idea', 'review', 'failed', 'cancelled', 'unknown']) {
    const song = { status, style: 'Pop', lyrics: 'Words', job: { kind: 'lyrics' } };
    normalizeSongStatus(song);
    assert.equal(song.status, 'draft');
    const playable = { status, audioFile: 'song.mp3', job: { kind: 'audio' } };
    normalizeSongStatus(playable);
    assert.equal(playable.status, 'ready');
  }
  for (const phase of ['queued', 'downloading', 'preparing', 'rendering', 'saving']) {
    for (const kind of ['lyrics', 'audio']) {
      const song = { status: phase, job: { kind } };
      normalizeSongStatus(song);
      assert.equal(song.status, kind);
      assert.equal(song.job.phase, phase);
    }
  }
});
