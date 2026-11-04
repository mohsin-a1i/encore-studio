import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbcScore } from '../generation/lyrics/abc-score-parser.mjs';
import {
  createReferenceLyricsGuide,
  formatReferenceLyricsGuide,
} from '../generation/lyrics/reference-lyrics-guide.mjs';
import { createSongCompletionPrompt } from '../generation/lyrics/song-completion-prompt.mjs';
import { referenceAbc } from './helpers/comfy-fixtures.mjs';

const score = (vocal, instrumental = 'Z|') =>
  `X:1\nM:4/4\nL:1/8\nQ:1/4=120\nV: Vocal clef=treble\nV: Ins clef=treble\nK:C\n% verse\nV: Vocal\n${vocal}\nV: Ins\n${instrumental}\n`;

test('the reference becomes a compact section guide with instrumental space', () => {
  const guide = createReferenceLyricsGuide(referenceAbc);
  assert.deepEqual(guide.sections, [
    { name: 'intro', start: 0, end: 2, singing: [] },
    { name: 'verse', start: 2, end: 6, singing: [[2, 6]] },
    { name: 'chorus', start: 6, end: 10, singing: [[6, 10]] },
    { name: 'interlude', start: 10, end: 14, singing: [] },
    { name: 'chorus', start: 14, end: 18, singing: [[14, 18]] },
  ]);
  const formatted = formatReferenceLyricsGuide(guide);
  assert.match(formatted, /"interlude" \(10–14s\): instrumental only/);
  assert.match(formatted, /"verse" \(2–6s\): singing windows 2–6s/);
  assert.equal(guide.scoreHash, createReferenceLyricsGuide(referenceAbc).scoreHash);
  assert.notEqual(
    guide.scoreHash,
    createReferenceLyricsGuide(referenceAbc.replace('120', '100')).scoreHash,
  );
  assert.doesNotMatch(
    JSON.stringify(guide),
    /patterns|arrangement|syllables|midiPitch|noteAttacks/,
  );
});

test('barlines and short rests do not fragment a sentence into separate singing windows', () => {
  const guide = createReferenceLyricsGuide(score('C2z2E2F2|G2A2B2c2|', 'Z2|'));
  assert.deepEqual(guide.sections[0].singing, [[0, 4]]);
  const continuous = 'C2D2E2F2|'.repeat(6);
  assert.deepEqual(createReferenceLyricsGuide(score(continuous, 'Z3|Z3|')).sections[0].singing, [
    [0, 12],
  ]);
});

test('long vocal rests remain space for sound rather than extra lyric slots', () => {
  const guide = createReferenceLyricsGuide(score('C2z6|D4z4|', 'Z2|'));
  assert.deepEqual(guide.sections[0].singing, [
    [0, 0.5],
    [2, 3],
  ]);
});

test('ties crossing section boundaries keep the sustained vocal available in both sections', () => {
  const abc = score('C8-|') + '% chorus\nV: Vocal\nC8|\nV: Ins\nZ|\n';
  const parsed = parseAbcScore(abc);
  assert.equal(parsed.voices.Vocal.events.length, 1);
  assert.equal(parsed.voices.Vocal.events[0].durationQuarter, 8);
  assert.deepEqual(
    createReferenceLyricsGuide(abc).sections.map((section) => section.singing),
    [[[0, 2]], [[2, 4]]],
  );
});

test('the shared parser retains accidentals, merged ties, meter changes, and timing', () => {
  const parsed = parseAbcScore(score('^F8-|F2F6|', 'Z2|'));
  assert.deepEqual(
    parsed.voices.Vocal.events.map((note) => [note.midiPitch, note.durationQuarter]),
    [
      [66, 5],
      [65, 3],
    ],
  );
  const changing = score('C8|\nM:3/4\nD6|', 'Z|\nM:3/4\nZ|');
  assert.deepEqual(createReferenceLyricsGuide(changing).sections[0].singing, [[0, 3.5]]);
});

test('unsupported scores fail without inventing timings or silently discarding the reference', () => {
  for (const vocal of ['C/2D7|', 'C7|', 'C8-|', 'C4-D4|', '(3CDE F5|'])
    assert.throws(() => createReferenceLyricsGuide(score(vocal)), /could not be analyzed/);
  assert.throws(() => createReferenceLyricsGuide(score('Z|')), /no vocal melody/);
});

test('one short prompt asks for natural sentences and space for effects with optional reference timing', () => {
  const idea = 'An Urdu song about hope';
  const prompt = createSongCompletionPrompt(
    { idea, style: 'Acoustic folk', title: 'My title' },
    createReferenceLyricsGuide(referenceAbc),
  );
  assert.match(prompt, /finish a thought or natural clause before a long pause/);
  assert.match(prompt, /Do not fill every available moment with words/);
  assert.match(prompt, /section boundaries and barlines do not require pauses/);
  assert.match(prompt, /transliterate that language into Latin letters/);
  assert.match(prompt, /\[Instrumental\]/);
  assert.match(prompt, /singing windows/);
  assert.ok(prompt.includes(idea));
  assert.match(prompt, /"style":"Acoustic folk"/);
  assert.match(prompt, /"title":"My title"/);
  assert.match(prompt, /Return only the fields requested by the supplied schema/);
  assert.doesNotMatch(prompt, /return it unchanged|exactly as written/);
  assert.ok(prompt.length < 2300);
  assert.equal(prompt.includes(referenceAbc), false);
  assert.doesNotMatch(prompt, /syllable quota|pattern|arrangement|story arc|chorus match/);
  const withoutReference = createSongCompletionPrompt({ idea: 'A playful song' });
  assert.doesNotMatch(withoutReference, /reference timing|singing windows|Tempo:/);
  assert.doesNotMatch(withoutReference, /Musical style:/);
  assert.match(withoutReference, /Leave room between vocal lines/);
});

test('prior lyrics are contrast material only when new lyrics need to be generated', () => {
  const old = ['Previous chorus that should not be repeated'];
  const fresh = createSongCompletionPrompt({ idea: 'A fresh story', lyrics: '  ' }, null, old);
  assert.match(fresh, /Previous lyrics to avoid/);
  assert.match(fresh, /as different as possible/);
  assert.ok(fresh.includes(old[0]));
  const supplied = createSongCompletionPrompt(
    { idea: 'Fill in metadata', lyrics: 'My own words' },
    null,
    old,
  );
  assert.match(supplied, /My own words/);
  assert.match(supplied, /preserve any lyrics supplied by the user/);
  assert.doesNotMatch(
    supplied,
    /Previous lyrics to avoid|Previous chorus|as different as possible/,
  );
});
