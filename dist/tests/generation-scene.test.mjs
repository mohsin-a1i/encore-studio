import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGenerationScene } from '../generation/generation-scene.js';

test('lyrics generation displays the saved idea and current musical style', () => {
  const html = renderGenerationScene({
    status: 'lyrics',
    idea: 'The submitted idea',
    style: 'Old style',
    lyrics: 'Old words',
    job: { kind: 'lyrics' },
  });
  assert.match(html, /The submitted idea/);
  assert.match(html, /Old style/);
  assert.doesNotMatch(html, /Previous idea|Old words|Writing Lyrics/);
  assert.doesNotMatch(html, /<textarea|<input/);
});

test('audio generation displays the committed text without exposing reference notation or editor controls', () => {
  const html = renderGenerationScene({
    status: 'audio',
    idea: 'An evening story',
    style: 'Orchestral pop',
    lyrics: '[Verse]\nThe first line\n\n[Chorus]\nThe second line',
    referenceABC: 'X:1\nK:C\nC D E F|',
    job: { kind: 'audio' },
  });
  for (const text of ['Orchestral pop', '[Verse]\nThe first line', '[Chorus]\nThe second line'])
    assert.ok(html.includes(text));
  assert.doesNotMatch(html, /Composing Song|<textarea|<input|Reference score|ABC|X:1|C D E F/);
});

test('generation inputs retain safe text and queued work remains described as queued', () => {
  const html = renderGenerationScene({
    status: 'audio',
    idea: '<script>alert(1)</script>',
    style: 'Rock & strings',
    lyrics: 'A < B',
    job: { kind: 'audio', phase: 'queued' },
  });
  assert.doesNotMatch(html, /alert\(1\)/);
  assert.match(html, /Rock &amp; strings/);
  assert.match(html, /A &lt; B/);
  assert.match(html, /waiting for its turn/);
  assert.doesNotMatch(html, /<script>/);
});

test('reference material shows the recording name without a generic video label or link', () => {
  const link = 'https://www.youtube.com/watch?v=BaW_jenozKc';
  const song = { status: 'lyrics', sampleUrl: link, job: { kind: 'lyrics' } };
  const unnamed = renderGenerationScene(song);
  assert.doesNotMatch(unnamed, /YouTube video|Instagram video/);
  assert.doesNotMatch(unnamed, /youtube\.com\/watch/);
  const named = renderGenerationScene({ ...song, sampleTitle: 'A favorite live take' });
  assert.match(named, /A favorite live take/);
  assert.doesNotMatch(named, /youtube\.com\/watch/);
});
