import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceMelody } from '../generation/reference-melody.mjs';
import { parseAbcScore } from '../generation/lyrics/abc-score-parser.mjs';
import { referenceAbc } from './helpers/comfy-fixtures.mjs';

test('melody-only cover preparation frees harmony while preserving both melodies and all timing', () => {
  const abc = referenceAbc.replace('A8|', '"Dmaj7"A4-"Bm7"A4|');
  const melody = createReferenceMelody(abc);
  assert.deepEqual(parseAbcScore(melody), parseAbcScore(abc));
  assert.match(melody, /name="Vocal Melody"/);
  assert.match(melody, /A4-A4/);
  assert.doesNotMatch(melody, /"Dmaj7"|"Bm7"|"D"F/);
  assert.ok(abc.includes('"Dmaj7"'));
  assert.equal(createReferenceMelody(melody), melody);
});

test('reference preparation preserves section comments, header quotes, accidentals, and key changes', () => {
  const abc = referenceAbc
    .replace('T:', 'T:"Keep this title"')
    .replace('% verse', '% verse "keep comment"')
    .replace('"D"F2-F2A2z2|', '"D"^F2-F2[K:C]A2z2|')
    .replace('Z2|', '"D"z4[K:C]z4|Z|');
  const melody = createReferenceMelody(abc);
  assert.match(melody, /T:"Keep this title"/);
  assert.match(melody, /% verse "keep comment"/);
  assert.deepEqual(parseAbcScore(melody), parseAbcScore(abc));
});

test('unsupported reference notation stops cover preparation before a graph is submitted', () => {
  assert.throws(
    () => createReferenceMelody(referenceAbc.replace('A8|', '(3ABC|')),
    /could not be analyzed/,
  );
});
