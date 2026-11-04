import { isDeepStrictEqual } from 'node:util';
import { parseAbcScore } from './lyrics/abc-score-parser.mjs';

// Keep the original transcription on the entity. For a cover, remove harmony
// constraints from a derived score while preserving both native melodies.
export function createReferenceMelody(abc) {
  const source = parseAbcScore(abc);
  const melody = abc
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(?:[A-Za-z]:|%)/.test(line)) return line;
      return line.replace(/"[^"\n]*"/g, '');
    })
    .join('\n');
  const prepared = parseAbcScore(melody);
  if (!isDeepStrictEqual(source, prepared))
    throw new Error('Preparing the reference melody changed its musical structure.');
  return melody;
}
