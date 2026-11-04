export function getGenerationCopy(song) {
  const writing = song.job?.kind === 'lyrics' || song.status === 'lyrics';
  if (song.job?.phase === 'queued')
    return {
      title: writing ? 'The missing pieces are next.' : 'Your song is next on the mixing desk.',
      description: writing
        ? 'Your idea and song details are waiting for their finishing touches.'
        : 'The words are set and the sound is imagined. Your next take is waiting for its turn.',
    };
  if (song.job?.phase === 'downloading')
    return {
      title: 'Gathering a little inspiration.',
      description: 'Your reference is arriving, ready to lend its melody and rhythm to this take.',
    };
  if (song.job?.phase === 'saving')
    return {
      title: 'One last polish before the encore.',
      description: 'The sound is here. A few finishing touches, and it’s yours to hear.',
    };
  return writing
    ? {
        title: 'Bringing the missing pieces together.',
        description:
          'Your idea, words, and inspiration are shaping the details your song still needs.',
      }
    : {
        title: 'From the page to the speakers.',
        description:
          'Your words are finding their sound. Melody, rhythm, and atmosphere are coming together into one song.',
      };
}
