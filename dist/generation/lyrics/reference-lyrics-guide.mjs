import { createHash } from 'node:crypto';
import { parseAbcScore } from './abc-score-parser.mjs';

// Broad singing windows, not a note-by-note lyric assignment. Short rests and
// barlines stay inside a window so they do not break up a natural sentence.
export function createReferenceLyricsGuide(abc) {
  const score = parseAbcScore(abc);
  const notes = score.voices.Vocal.events.filter((event) => event.kind === 'note');
  if (!notes.length) throw new Error('The reference score has no vocal melody to fit lyrics to.');
  const seconds = (quarter) => Math.round((quarter * 60 * 10) / score.tempoBpm) / 10;
  const windows = [];
  for (const note of notes) {
    const previous = windows.at(-1);
    const end = note.startQuarter + note.durationQuarter;
    if (previous && note.startQuarter - previous.end < 2) previous.end = end;
    else windows.push({ start: note.startQuarter, end });
  }

  return {
    version: 1,
    scoreHash: createHash('sha256').update(abc).digest('hex'),
    tempoBpm: score.tempoBpm,
    sections: score.sections.map((section, index) => {
      const end = score.sections[index + 1]?.startQuarter ?? score.durationQuarter;
      return {
        name: section.label,
        start: seconds(section.startQuarter),
        end: seconds(end),
        singing: windows
          .filter((window) => window.start < end && window.end > section.startQuarter)
          .map((window) => [
            seconds(Math.max(window.start, section.startQuarter)),
            seconds(Math.min(window.end, end)),
          ]),
      };
    }),
  };
}

export function formatReferenceLyricsGuide(guide) {
  return [
    `Tempo: ${guide.tempoBpm} BPM. Approximate seconds from the score; gaps are room for music and effects.`,
    ...guide.sections.map(
      (section) =>
        `${JSON.stringify(section.name)} (${section.start}–${section.end}s): ${
          section.singing.length
            ? `singing windows ${section.singing.map(([start, end]) => `${start}–${end}s`).join(', ')}`
            : 'instrumental only'
        }.`,
    ),
  ].join('\n');
}
