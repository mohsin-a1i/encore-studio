import test from 'node:test';
import assert from 'node:assert/strict';
import { getLyricsExcerpt } from '../app/text-helpers.js';

test('lyric previews use the first two lyric lines and skip section labels', () => {
  assert.equal(
    getLyricsExcerpt(' [Intro] \n\n First line \n[Verse 1]\nSecond line\nThird line'),
    'First line / Second line',
  );
  assert.equal(getLyricsExcerpt('[Instrumental]\n\n'), '');
  assert.equal(getLyricsExcerpt(undefined), '');
});
