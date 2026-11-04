// Read the bounded two-voice ABC format exported by YuE2 and SheetSage2.
// Quarter-note positions stay exact: native note lengths use binary fractions.
const supportedDurations = new Set([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48]);
const naturalPitches = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 };
const majorKeys = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
const minorKeys = [
  'Abm',
  'Ebm',
  'Bbm',
  'Fm',
  'Cm',
  'Gm',
  'Dm',
  'Am',
  'Em',
  'Bm',
  'F#m',
  'C#m',
  'G#m',
  'D#m',
  'A#m',
];
const musicToken = /"([^"\n]*)"|\[K:([^\]\n]+)\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)(\d*)(-?)/y;

function scoreError(message) {
  throw new Error(`The reference score could not be analyzed: ${message}`);
}

function readMeter(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const numerator = Number(match?.[1]);
  const denominator = Number(match?.[2]);
  if (!numerator || !denominator || denominator > 1024 || denominator & (denominator - 1))
    scoreError('unsupported time signature.');
  return { numerator, denominator };
}

function keyAccidentals(key) {
  const keys = key.endsWith('m') ? minorKeys : majorKeys;
  const index = keys.indexOf(key);
  if (index < 0) scoreError('unsupported key signature.');
  const fifths = index - 7;
  return Object.fromEntries(
    [...(fifths < 0 ? 'BEADGCF' : 'FCGDAEB')]
      .slice(0, Math.abs(fifths))
      .map((letter) => [letter, Math.sign(fifths)]),
  );
}

function createVoice() {
  return { time: 0, events: [], bars: [], key: '', meter: null, pendingTie: null };
}

function addBar(voice, body, unitQuarter) {
  const { numerator, denominator } = voice.meter;
  const durationQuarter = (numerator * 4) / denominator;
  const bar = {
    number: voice.bars.length + 1,
    startQuarter: voice.time,
    durationQuarter,
    meter: `${numerator}/${denominator}`,
  };
  const fullRest = /^Z([1-4])?$/.exec(body);
  if (fullRest) {
    if (voice.pendingTie) scoreError('a tied note continues into a rest.');
    const count = Number(fullRest[1] || 1);
    for (let index = 0; index < count; index++) {
      voice.bars.push({ ...bar, number: bar.number + index, startQuarter: voice.time });
      voice.events.push({ kind: 'rest', startQuarter: voice.time, durationQuarter });
      voice.time += durationQuarter;
    }
    return;
  }
  const accidentals = {};
  let offsetQuarter = 0;
  let cursor = 0;
  while (cursor < body.length) {
    if (/\s/.test(body[cursor])) {
      cursor++;
      continue;
    }
    musicToken.lastIndex = cursor;
    const token = musicToken.exec(body);
    if (!token) scoreError(`unsupported notation in bar ${bar.number}.`);
    cursor = musicToken.lastIndex;
    if (token[1] !== undefined) continue; // Chord symbols do not create syllable slots.
    if (token[2] !== undefined) {
      voice.key = token[2].trim();
      keyAccidentals(voice.key);
      for (const letter of Object.keys(accidentals)) delete accidentals[letter];
      continue;
    }
    const [, , , accidental, note, octave, length, tie] = token;
    const units = Number(length || 1);
    if (!supportedDurations.has(units)) scoreError(`unsupported note length in bar ${bar.number}.`);
    const noteDuration = units * unitQuarter;
    if (offsetQuarter + noteDuration > durationQuarter)
      scoreError(`bar ${bar.number} exceeds its time signature.`);
    const startQuarter = voice.time + offsetQuarter;
    if (note === 'z') {
      if (accidental || octave || tie || voice.pendingTie) scoreError('invalid rest or tie.');
      voice.events.push({ kind: 'rest', startQuarter, durationQuarter: noteDuration });
    } else {
      if (octave.includes(',') && octave.includes("'")) scoreError('mixed octave marks.');
      const letter = note.toUpperCase();
      const writtenPitch =
        naturalPitches[letter] +
        (note === letter ? 0 : 12) +
        12 *
          ([...octave].filter((mark) => mark === "'").length -
            [...octave].filter((mark) => mark === ',').length);
      if (accidental)
        accidentals[letter] =
          accidental === '=' ? 0 : accidental.length * (accidental[0] === '^' ? 1 : -1);
      // Native exporters carry accidentals by letter across octaves within a bar.
      let midiPitch =
        writtenPitch + (accidentals[letter] ?? keyAccidentals(voice.key)[letter] ?? 0);
      let event;
      if (voice.pendingTie) {
        event = voice.pendingTie.event;
        if (!accidental && writtenPitch === voice.pendingTie.writtenPitch)
          midiPitch = event.midiPitch;
        if (midiPitch !== event.midiPitch) scoreError('a tie changes pitch.');
        event.durationQuarter += noteDuration;
      } else {
        if (midiPitch < 0 || midiPitch > 127) scoreError('note pitch is outside the MIDI range.');
        event = {
          kind: 'note',
          startQuarter,
          durationQuarter: noteDuration,
          midiPitch,
          bar: bar.number,
        };
        voice.events.push(event);
      }
      voice.pendingTie = tie ? { event, writtenPitch } : null;
    }
    offsetQuarter += noteDuration;
  }
  if (offsetQuarter !== durationQuarter)
    scoreError(`bar ${bar.number} does not fill its time signature.`);
  voice.bars.push(bar);
  voice.time += durationQuarter;
}

export function parseAbcScore(text) {
  const voices = { Vocal: createVoice(), Ins: createVoice() };
  const sections = [];
  let activeVoice = null;
  let unitQuarter = null;
  let tempoBpm = null;
  let initialKey = '';
  let initialMeter = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) scoreError('ABC directives are not supported.');
    if (line.startsWith('%')) {
      const label = line.slice(1).trim();
      if (label) {
        const section = { label, startQuarter: voices.Vocal.time };
        if (sections.at(-1)?.startQuarter === section.startQuarter) sections.pop();
        sections.push(section);
      }
      continue;
    }
    const field = /^([A-Za-z]):\s*(.*)$/.exec(line);
    if (field) {
      const [, name, value] = field;
      if (name === 'V') {
        const voiceName = value.split(/\s/)[0];
        if (!Object.hasOwn(voices, voiceName)) scoreError('expected Vocal and Ins voices.');
        if (value === voiceName) activeVoice = voices[voiceName];
      } else if (name === 'M' || name === 'K') {
        const parsed = name === 'M' ? readMeter(value) : value;
        if (name === 'K') keyAccidentals(value);
        for (const voice of activeVoice ? [activeVoice] : Object.values(voices))
          voice[name === 'M' ? 'meter' : 'key'] = parsed;
        if (!activeVoice) {
          if (name === 'M') initialMeter = value;
          else initialKey = value;
        }
      } else if (name === 'L' && !activeVoice) {
        const match = /^1\/(\d+)$/.exec(value);
        const denominator = Number(match?.[1]);
        if (!denominator || denominator > 1024 || denominator & (denominator - 1))
          scoreError('unsupported unit note length.');
        unitQuarter = 4 / denominator;
      } else if (name === 'Q' && !activeVoice) {
        const match = /^1\/4=(\d+)$/.exec(value);
        tempoBpm = Number(match?.[1]);
        if (!tempoBpm) scoreError('expected a quarter-note tempo.');
      } else if (!['X', 'T'].includes(name) || activeVoice) scoreError('unsupported ABC field.');
      continue;
    }
    if (!activeVoice || !unitQuarter || !tempoBpm || !activeVoice.meter || !activeVoice.key)
      scoreError('missing voice, meter, key, note length, or tempo.');
    if (!line.endsWith('|')) scoreError('a music line must end at a barline.');
    for (const bar of line.slice(0, -1).split('|')) {
      if (!bar.trim()) scoreError('empty or unsupported repeat barline.');
      addBar(activeVoice, bar.trim(), unitQuarter);
    }
  }
  if (!voices.Vocal.bars.length || !voices.Ins.bars.length)
    scoreError('both native voices are required.');
  if (Object.values(voices).some((voice) => voice.pendingTie))
    scoreError('the score ends with an unresolved tie.');
  if (JSON.stringify(voices.Vocal.bars) !== JSON.stringify(voices.Ins.bars))
    scoreError('the vocal and instrumental bar grids differ.');
  if (!sections.length || sections[0].startQuarter > 0)
    sections.unshift({ label: 'Song', startQuarter: 0 });
  return {
    tempoBpm,
    unitQuarter,
    key: initialKey,
    meter: initialMeter,
    durationQuarter: voices.Vocal.time,
    sections,
    voices,
  };
}
