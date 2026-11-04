import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongCompletionSchema } from '../generation/lyrics/song-completion-schema.mjs';

test('lyric schemas request only missing fields and genre tags that need refreshing', () => {
  const complete = { title: 'My song', style: 'Folk', genres: ['Folk'], genreStyle: 'Folk' };
  for (const [song, expected] of [
    [{}, ['title', 'style', 'lyrics', 'genres']],
    [complete, ['lyrics']],
    [{ ...complete, lyrics: '[Verse]\nAlready written' }, []],
    [{ ...complete, title: '' }, ['title', 'lyrics']],
    [{ ...complete, style: '' }, ['style', 'lyrics', 'genres']],
    [{ ...complete, genres: [] }, ['lyrics', 'genres']],
    [{ ...complete, style: 'Rock' }, ['lyrics', 'genres']],
  ]) {
    const schema = createSongCompletionSchema(song);
    assert.deepEqual(schema.required, expected);
    assert.deepEqual(Object.keys(schema.properties), expected);
    assert.equal(schema.additionalProperties, false);
  }
});

test('a song with lyrics only requests missing details before composition', () => {
  const song = {
    title: 'My song',
    style: 'Folk',
    lyrics: '[Verse]\nHello',
    genres: ['Folk'],
    genreStyle: 'Folk',
  };
  assert.deepEqual(createSongCompletionSchema(song).required, []);
  assert.deepEqual(createSongCompletionSchema({ ...song, title: '' }).required, ['title']);
  assert.deepEqual(createSongCompletionSchema({ ...song, style: 'Rock' }).required, ['genres']);
  assert.deepEqual(createSongCompletionSchema({ ...song, style: '' }).required, [
    'style',
    'genres',
  ]);
});
